const parse = require('esprima').parse
const codegen = require('escodegen').generate
const assert = require('assert')
const util = require('util')
const _ = require('lodash')
const flatMap = require('lodash/flatMap')

const es = require('./es')
const joinfn = require('./query/join')
const projectfn = require('./query/project')
const { resolveIdentifiers } = require('./query/resolve')

module.exports = { evaluate, QueryError }

const queryCommands = { from, product, join, where, project, leftJoin, set, destroy, $call }

function QueryError(message) {
    this.name = 'QueryError'
    this.message = message || 'bad query'
    this.stack = (new Error()).stack
}


// Take a list of function calls and return the compiled estree AST
function evaluate(calls, env) {
    let [first, ...rest] = calls

    if (_.isFunction(first)) {
        return $call(first, env, rest)
    }

    if (!first) { return es.empty() }

    assert(queryCommands[first.func], "Unknown query command: " + first.func)

    let ast = queryCommands[first.func](first.args, env, rest)
    assert(ast && ast.type, "Error while evaluating " + first.func)
    return ast
}


// loop over a table and output each row
//  - must be the first command in a view
function from(args, env, next) {
    assert(env.scope === undefined, "from() must be the first clause in a view")
    return product(args, env, next)
}

// relational algebra product: for each row of A, output the row plus every row of B
function product(args, env, next) {
    if (args.length > 1) {
        let multiproduct = args.map(arg => ({ func: 'product', args: [arg] }))
        return evaluate(multiproduct.concat(next), env)
    }

    let { ident, alias } = args[0], relName = ident
    alias = alias || ident

    if (env.isVar(relName)) {
        return productVar(relName, alias, env, next)
    } else if (env.isView(relName)) {
        return productView(relName, alias, env, next)
    }

    return productTable(relName, alias, env, next)
}

// natural join: like product() + where() that filters to rows that have the
// same values for any identically-named columns
function join(args, env, next) {
    assert.equal(1, args.length)
    let steps = joinfn.steps(env, args[0], scopeForRelation)
    return evaluate(steps.concat(next), env)
}


// similar to join, but if no rows in B match a row in A, return null for all the columns in B
function leftJoin(args, env, next) {
    assert.equal(1, args.length)
    let alias = args[0].alias || args[0].ident,
        found = es.identifier(env.uniqueVar('lj$' + args[0].ident + '$found')),
        joinedScoope

    function foundCase(env, remainder) {
        joinedScoope = env.scope
        // found a row for the joined table
        // set found and "resume" the query
        return es.enblock(es.set(found, true), evaluate(remainder, env))
    }

    function noRowsCase(env, remainder) {
        env = env.replaceScope(joinedScoope.map(col =>
            col.relname === alias
                ? Object.assign({}, col, { ref: es.literal(null) })
                : col))
        return evaluate(remainder, env)
    }

    let joinSteps = joinfn.steps(env, args[0], scopeForRelation)
        .concat(foundCase, next)
    let noRowsSteps = [noRowsCase].concat(next)

    let foundAST = evaluate(joinSteps, env),
        noRowsAST = {
            type: "IfStatement",
            test: es.not(found),
            consequent: es.enblock(evaluate(noRowsSteps, env)),
        }

    return es.enblock(es.var(found, false), foundAST, noRowsAST)
}


// Filter output to rows that match a JS expression
function where(args, env, next) {
    assert.equal(1, args.length)
    assert(args[0].javascript, "Expected a JS expression, got " + util.inspect(args[0]))

    let program = parse(args[0].javascript)

    // let { env:childEnv, varStmt } = env.cacheNames(findNames(condition))

    // Replace expr with one that references locally available data
    resolveIdentifiers(program, env)

    let condition = program.body[0].expression
    assert(condition.type)

    return es.enblock({
        type: "IfStatement",
        test: condition,
        consequent: evaluate(next, env),
        alternate: null
    })
}

// Change the scope for future steps to include any combination of existing
// columns and new columns derived from the existing ones
function project(args, env, next) {
    let toCache = []

    env = env.replaceScope(flatMap(args, expr => {
        if (expr.ident) {
            let [col, rel] = expr.ident.split('.').reverse()
            if (col === '*') {
                assert.equal(undefined, expr.alias, "Can't alias *")
                return projectfn.scopeEntryForProjectAll(env, rel)
            }
            return projectfn.scopeEntryForProjectColumn(env, expr.ident, expr.alias)
        } else if (expr.javascript) {
            let scope = projectfn.scopeEntryForProjectDerived(env,
                expr.javascript, expr.vars, expr.alias
            )
            toCache.push(fqcol(scope))
            return scope
        } else {
            throw new QueryError("Don't understand: " + util.inspect(expr))
        }
    }))

    let { env:child, varStmt } = env.cacheNames(toCache)

    return es.enblock(varStmt, evaluate(next, child))
}


// Used by the compiler to insert code
function $call(args, env, next) {
    // assert.equal(0, next.length)

    let out = args(env, next, evaluate)
    assert(out.type)
    return out
}


/*
 * Commands
 */

// TODO: should we explicitly disallow these in views?
function set(args, env, next) {
    let [col, expr] = args

    let program = parse(expr.javascript)
    resolveIdentifiers(program, env)

    let right = program.body[0].expression,
        left = env.getCol(col.ident)
    assert(left, "Can't set: " + col.ident)

    return es.enblock(
        es.set(left.origRef || left.ref, right),
        evaluate(next, env)
    )
}


// Delete the table rows referenced in the output of the current query
function destroy(args, env, next) {
    if (_.isEmpty(args)) {
        throw new QueryError("destroy: must specify at least one source table name")
    }

    let tables = new Set(_.map(args, 'ident'))

    let toDelete = _(env.scope)
        .filter('rowRef')
        .filter(({tableName}) => tables.has(tableName))
        .map(({rowRef, tableName}) => enqueueDelete(es.literal(tableName), rowRef))
        .uniqWith(_.isEqual)
        .map(es.wrapExpression)
        .value()

    if (_.isEmpty(toDelete)) {
        throw new QueryError(`destroy: no rows in specified tables: ${_.map(args, 'ident')}`)
    }
    return es.enblock(...(toDelete.concat(evaluate(next, env))))
}


/*
 * Utility
 */

function productTable(relName, alias, env, next) {
    let loopCounter = es.identifier(env.uniqueVar("i")),
        tableDataArray = env.tableDataArray(relName),
        rowRef = es.member.brackets(tableDataArray, loopCounter),
        savedLength = es.identifier(env.uniqueVar("len"))

    let addedScope = env.columnsWithRef(relName, rowRef)
    overwriteRelInScope(addedScope, alias)
    env = env.extendScope(addedScope)

    let { env:child, varStmt } = env.cacheNames(addedScope.map(fqcol))

    return es.simpleFor({
        counter: loopCounter,
        length: savedLength,
        iterations: es.member.dot(tableDataArray, 'length'),
        body: es.enblock(varStmt, evaluate(next, child)),
    })
}

function productVar(varName, alias, env, next) {
    env = env.extendScope(Object.assign(env.varScope(varName), { name: alias }))
    return evaluate(next, env)
}

function productView(relName, alias, env, next) {
    // evaluate the view for its scope, then continue evaluating the rest of the
    // query where the view leaves off
    let viewSteps = env.viewDefn(relName).concat({
        func: '$call',
        args: ({scope: finalScope}) => {
            overwriteRelInScope(finalScope, alias)
            env = env.extendScope(finalScope)
            let { env:child, varStmt } = env.cacheNames(finalScope.map(fqcol))

            return es.enblock(varStmt, evaluate(next, child))
        }
    })

    return evaluate(viewSteps, env.rootEnv())
}

function scopeForRelation(relName, env) {
    if (env.isView(relName)) {
        let finalScope
        evaluate(env.viewDefn(relName).concat(env => {
            finalScope = env.scope
            return es.empty()
        }), env.rootEnv())

        overwriteRelInScope(finalScope, relName)
        return finalScope
    }

    return env.columnsWithRef(relName)
}


function enqueueDelete(tableAST, rowAST) {
    let deleteCommandObject = {
        type: "ObjectExpression",
        properties: [{
            type: "Property",
            key: es.identifier('t'),
            value: tableAST,
        }, {
            type: "Property",
            key: es.identifier('r'),
            value: rowAST,
        }]
    }

    return {
        type: 'CallExpression',
        callee: es.member.dot(es.identifier('queuedDeletes'), es.identifier('push')),
        arguments: [deleteCommandObject]
    }
}

function overwriteRelInScope(scope, newName) {
    scope.forEach(col => col.relname = newName)
}

function fqcol({relname, name}) { return relname + '.' + name }

function passthru(_, env, next) {
    return evaluate(next, env)
}

