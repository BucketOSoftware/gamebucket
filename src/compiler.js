const _ = require('lodash')
const { flow, map, countBy, filter, take, fromPairs, forEach } = require('lodash/fp')

const parser = require('./parser')
const group = require('./query/group')
const Environment = require('./environment')
const query = require('./query')
const es = require('./es')

const estraverse = require('estraverse')
const csvparse = require('csv-parse/lib/sync')
const codegen = require('escodegen').generate
const Mustache = require('mustache')

const fs = require("fs")
const path = require("path")
const assert = require('assert')
const util = require('util')


module.exports = {
    compile,
    CompilerError
}

/*
 * Templating
 */ 

// Disable HTML escaping
Mustache.escape = v => v

const template = _.memoize(function template(name) {
    let t = fs.readFileSync(path.join(__dirname, 'templates', name + '.ms'), 'utf8').toString()
    Mustache.parse(t)
    return t
})

function render(templateName, context) {
    return Mustache.render(template(templateName), context)
}


const checkDuplicates = flow(
    filter(n => !!n.declaration),
    countBy("declaration"),
    filter(c => c > 1),
    take(1),
    forEach((_, decl) => {
        throw new CompilerError(`Duplicate definition of ${decl}`)
    })
)

function noFile(/* file */) {
    throw new Error("Pass in a function that returns contents of a file")
}

// Main entry point. Takes a string with .bucket language code, and optionally
// a function that returns the contents of a file for importing CSVs as data
function compile(bucketCode, fileContents=noFile) {
    let cst = parser.parse(bucketCode)

    // Create a map between name symbols and their definitions,
    // after ensuring no name has been used twice
    checkDuplicates(cst)
    let ast = flow(
        map(node => [node.declaration, node.definition]),
        fromPairs
    )(cst)

    let imports = filter('import', cst)

    let env = new Environment(ast, imports)

    let tableDefs = _.pickBy(ast, v => _.has(v, 'table')),
        tables = _.keys(tableDefs),
        scalars = _.pickBy(ast, v => _.has(v, 'scalar'))

    // enumerations declared in the AST
    let enumTypes = _.chain(ast)
        .pickBy([['type', 'func'], 'enum'])
        .map(({type},name) => ({ name: name, values: _.map(type.args, 'ident') } ))
        .value()

    // Map of views, name => estree ASTs
    let views = _.chain(ast)
        .pickBy(v => _.has(v, 'view'))
        .pickBy(v => v.visibility === 'public')
        .map((v, k) => [k, codeForView(v, env, k)])

    // Map of commands, name => estree ASTs
    let commands = _.chain(ast)
        .pickBy(v => _.has(v, 'command'))
        .map((v, k) => [k, codeForCommand(v, env, k)])
        .value()

    // Build a string of everything that needs to go in the prototype
    let bucketPrototype = views
        .concat(commands)
        .map(([k, v]) => `Bucket.prototype.${k} = ${v}`)
        .join("\n\n")
        .value()

    return render('main', {
        privateVars:
            env.privateVars,
        scalars:
            scalarConstructorProps(scalars),
        codeChunks:
            _.map(tables, tbl => codeForTable(tbl, env, fileContents)),
        constructorProps:
            _.map(tables, tbl => `this.${tbl} = new ${internalNameForTable(tbl)}()`),
        imports,
        bucketPrototype,
        enumTypes,
        tables,
    })
}


function internalNameForTable(name) {
    return 'Table$' + name
}


function scalarConstructorProps(scalars) {
    return _.map(scalars, ({ scalar, type, init }, name) => {
        let length
        [type, length] = type
        if (length) {
            throw new Error(`Scalar ${name} is a vector; this is unsupported`)
        }

        return { 
            name,
            type,
            mutable: scalar === 'var',
            init: init || 'null',
            privName: '$' + name,
        }
    })
}

function codeForTable(tbl, env, fileContents) {
    let columns = env.columns(tbl),
        meta = env.tableMeta(tbl)

    let expandedCols = _.flatMap(columns, column => {
        let {name, type, length, isVector} = column
        return !isVector ? { name, type }
            : _.map(_.times(length), idx => ({
                name: name + idx,
                type,
                idx,
                vector: name,
            }))
    })

    let initialData = [],
        indices = []

    meta.forEach(({ func, args }) => {
        if (func === 'source') {
            let [file] = args
            file = fileContents(file)
            initialData = processCSV(file, columns)
        } else if (func === 'unique') {
            let cols = _.map(args, ({ident, alias}) => {
                if (alias) {
                    throw new CompilerError(`syntax error: alias ${alias} given for index on ${ident}`)
                }

                return ident
            })

            indices.push({
                cols: `['${cols.join("','")}']`,
            })
        } else {
            throw new Error(`Unknown metadata on table '${tbl}': ${func}`)
        }
    })

    indices = _.uniqWith(indices, _.isEqual)

    return render('table', {
        klass: internalNameForTable(tbl),
        columns,
        initialData,
        expandedCols,
        indices,
        insert: {
            args: _.map(expandedCols, 'name'),
        },
        callbackArgs: _.map(columns, ({name}) => `row.${name}`),
    })
}


function codeForView({ view }, env, name) {
    let params = [],
        body = []

    // Divide the steps around group functions -- currently just 'any' -- so
    // they can be handled separately
    let ungrouped = view.reduce((memo, step) => {
        if (step.func === 'any') {
            body.push(group.any(step.args, memo, env))
            return []
        }

        memo.push(step)
        return memo
    }, [])

    // this meaning of this condition is unclear
    if (ungrouped.length) {
        assert.equal(0, body.length, "so far we haven't looked into queries that do this")

        try {
            body = body.concat(codeToReturnRelation(ungrouped, params, env))
        } catch(e) {
            if (e instanceof query.QueryError) {
                throw new CompilerError(`while evaluating ${name}: ${e.message}`)
            }
            throw(e)
        }
    }

    let ast = {
        type: "FunctionExpression",
        params: params.map(es.identifier),
        body: { type: "BlockStatement", body: body },
    }

    pruneVars(ast)

    try {
        return codegen(ast)
    } catch(e) {
        throw new Error("Couldn't evaluate " + name + ": " + util.inspect(ast, { depth: null }))
    }
}


function codeToReturnRelation(steps, params, env) {
    params.push('$callback', '$empty')

    let callbackArgs,
        found = es.identifier(env.uniqueVar('found'))
        
    steps = steps.concat(env => {
        callbackArgs = env.scope.map(col => col.ref)
        return es.enblock(
            es.set(found, true),
            es.call('$callback', callbackArgs)
        )
    })

    return [
        es.var(found, false),
        query.evaluate(steps, env),
        es.stmt(`if ($empty && !${found.name}) $empty()`)
    ]
}

const flushDeletesAST = Object.freeze({
    type: "ExpressionStatement",
    expression: {
        type: "CallExpression",
        callee: es.identifier('flushDeletes'),
        arguments: [{ "type": "ThisExpression"} ]
    }
})

function codeForCommand({ command }, env, name) {
    let body
    try {
        body = query.evaluate(command, env)
    } catch(e) {
        if (e instanceof query.QueryError) {
            throw new CompilerError(`while evaluating ${name}: ${e.message}`)
        }
        throw(e)
    }

    let ast = {
        type: "FunctionExpression",
        params: [],
        // TODO: don't just assume there are deletes in there
        body: { type: "BlockStatement", body: [body, flushDeletesAST] },
    }

    try {
        return codegen(ast)
    } catch(e) {
        throw new Error("Couldn't evaluate " + name + ": " + util.inspect(ast, { depth: null }))
    }
}

function processCSV(file, columns) {
    let records = csvparse(file, {
        // convert numbers
        auto_parse: true,
        // trim whitespace
        trim: true,
        // don't complain about irregular rows, e.g. headers
        relax_column_count: true
    })

    // Ignore header for now
    records.shift()

    // FIXME: type-check incoming data
    return records.map(row => {
        return columns.map(c => {
            let val
            if (c.length) {
                let values = row.splice(0, c.length).join(',')
                val = `${c.constructor}.from([${values}])`
            } else {
                val = row.shift()
                if (typeof val === 'string') {
                    val = `"${val}"`
                }
            }

            return `${c.name}: ${val}`
        }).join(', ')
    })
}


// Remove unused variables generated by the queries.
// Was counting on minifiers to take care of this, but it turns out if you
// assign expressions like "a.b" to a variable, the minifier doesn't know if
// .b is a getter with side effects. But we know it isn't, so we can do that.
function pruneVars(ast) {
    let replaced
    do {
        let found = []
        estraverse.traverse(ast, {
            enter: function(node) {
                if (node.type === 'Identifier') {
                    found.push(node.name)
                }
            }
        })
                    
        let getRidOf = new Set(_.keys(_.pickBy(_.countBy(found), v => v === 1)))
        replaced = false
        estraverse.replace(ast, {
            enter: function(node) {
                if (node.type === 'VariableDeclarator') {
                    if (getRidOf.has(node.id.name)) {
                        replaced = true
                        return this.remove()
                    }
                }
            },
            leave: function(node) {
                if (node.type === 'VariableDeclaration' && _.isEmpty(node.declarations)) {
                    return this.remove()
                }
            }
        })

    } while (replaced)
}


// -----
function CompilerError(message) {
    this.name = 'CompilerError'
    this.message = message || 'Default Message'
    this.stack = (new Error()).stack
}
CompilerError.prototype = Object.create(Error.prototype)
CompilerError.prototype.constructor = CompilerError

exports.CompilerError = CompilerError