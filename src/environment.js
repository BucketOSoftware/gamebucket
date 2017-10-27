const _ = require('lodash')
const map = require('lodash/map')
const find = require('lodash/find')
const assert = require('assert')
const util = require('util')
const parse = require('esprima').parse

const es = require('./es')
const { AMBIGUOUS } = require('./query/resolve')
const { nativeMap } = require('./types')

let uniqueVarIdx = 0

// Takes the AST and returns information about the current scope. New scopes
// are created with replaceScope() or extendScope(), which use prototype inheritance
module.exports = class Environment {
    constructor(ast, imports) {
        this.ast = ast
        // Math is always available
        this.imports = imports.concat({ localname: 'Math' })
        this.root = this
        this.privateVars = []

        this._scalarRefs = _(ast).pickBy(v => _.has(v, 'scalar')).omitBy(_.isUndefined).map((v, k) => [
            k, this.varScope(k)
        ]).fromPairs().value()
    }

    replaceScope(newCols) {
        let env = this.child()
        env.scope = Object.freeze(newCols)
        env.updateScopeIndex()
        return env
    }

    extendScope(addlCols) {
        let env = this.child()
        env.scope = Object.freeze(this.scope ? this.scope.concat(addlCols) : addlCols)
        env.updateScopeIndex()
        return env
    }

    child() {
        return Object.create(this)
    }

    rootEnv() {
        return this.root
    }

    // returns JS expression to reference a table's raw data
    tableDataArray(tableName) {
        if (!this.ast[tableName].table) {
            throw new Error("Unknown table: " + tableName)
        }

        return Object.freeze(es.member.dot(
            es.member.dot({ type: "ThisExpression" }, tableName), '_data'))
    }

    // return column info for a table
    // assumes user-visible col names match internal object names
    columns(table) {
        return map(this.ast[table].table, column => {
            let [type, length] = column.type, name = column.name
            assert(length === undefined || nativeMap[type], "Invalid type: " + type)
            return {
                name,
                type,
                length,
                relname: table,
                tableName: table, // saved separately in case a query renames the relation
                constructor: nativeMap[type],
                isVector: length !== undefined,
            }   
        })
    }

    // return column info for a table, with JS refs to access the corresponding
    // object values
    columnsWithRef(table, rowRef) {
        return this.columns(table).map(col => {
            return Object.assign(col, {
                // estree ref to the column in the iterated row
                // allows us to map column references to code
                ref: es.member.dot(rowRef, col.name),
                rowRef,
            })
        })
    }

    // Return a pseudo-column entry that refers to a scalar [or vector]
    varScope(name) {
        let { scalar, type } = this.ast[name]
        assert(scalar, `${name} is not a scalar`)

        let length,
            privName = '$' + name // DRY
        ;
        [type, length] = type
            
        return {
            name, type, length,
            relname: null,
            constructor: nativeMap[type],
            isVector: length !== undefined,
            ref: es.member.dot(
                { type: "ThisExpression" },
                es.identifier(privName)
            )
        }
    }  

    tableMeta(table) {
        return this.ast[table].meta || {}
    }

    isVar(name) {
        assert(this.ast[name], "Unknown: " + name)
        return !!this.ast[name].scalar
    }

    isView(name) {
        return !!this.viewDefn(name)
    }

    isLocalName(name) {
        return find(this.imports, { localname: name })
    }

    viewDefn(name) {
        assert(this.ast[name], `No relation named ${name}`)
        return this.ast[name].view
    }

    // Returns an applicable index for the given columns in the relation `relName`
    getIndex(relName, cols) {
        if (cols.length > 1) {
            // TODO: support multi-column indexes
            return
        }
        cols = _.map(cols, 'name')

        let meta = this.getIndexes(relName)

        let foundIdx = meta.findIndex(({ func, args }) => {
            let indexedCols = _.map(args, 'ident')

            return _.intersection(cols, indexedCols).length > 0
        })

        if (foundIdx === -1) {
            return
        }

        assert(this.ast[relName].table, "Assuming it's a table")
        return parse(`this.${relName}._indices[${foundIdx}]`).body[0].expression
    }

    getIndexes(relName) {
        let meta = this.ast[relName].meta
        return meta ? meta.filter(({ func }) => func === 'unique') : []
    }

    // Returns a guaranteed-unique variable name starting with stem
    uniqueVar(stem) {
        return `${stem}$${uniqueVarIdx++}`
    }


    newClosure(name, [type, length]) {
        let privateName = '$priv$' + this.uniqueVar(name)
        // TODO: validate type
        assert(nativeMap[type], "Unknown type: " + type)
        this.privateVars.push({
            name: privateName,
            init: `new ${nativeMap[type]}(${length})`
        })
        return es.identifier(privateName)
    }

    canonicalize(name) {
        let canon = this.scopeIndex[name]
        if (canon.relname) {
            return canon.relname + '.' + canon.name
        } else {
            return canon.name
        }
    }

    availableNames() {
        let imports = map(this.imports, 'localname')
        return Object.keys(this.scopeIndex).concat(imports)
    }

    get(name) {
        let segments = name.split('.')
        return this.scopeIndex[name] || find(this.imports, { localname: segments[0] })
    }

    getCol(name) {
        return this.scopeIndex[name]   
    }

    // Replace more complex JS expressions with variables to avoid recalculations
    cacheNames(names) {
        let child = this.child()
        // Get a copy we can mutate. DONTYET: necessary?
        child.scope = _.clone(this.scope)

        let decls = _(names)
            .uniq()
            .map(n => this.scopeIndex[n])
            .reject(_.isNil) // don't touch global names
            .reject({ ref: { type: 'Identifier' } }) // prevents `b = a; c = b`
            .map(col => {
                let ref = col.ref,
                    internalName = es.identifier(this.uniqueVar(`${col.relname || ''}_${col.name}`))

                assert.equal(undefined, col.origRef)
                col.origRef = ref
                col.ref = internalName

                return {
                    type: "VariableDeclarator",
                    id: internalName,
                    init: ref,
                }
            }).value()

        if (decls.length) {
            return {
                varStmt: {
                    type: "VariableDeclaration",
                    kind: "var",
                    declarations: decls,
                },
                env: child,
            }
        } else {
            return {
                varStmt: es.empty(),
                env: this,
            }
        }
    }

    // Most of the time we want to reference things in the current scope by name,
    // so after a change to the scope we update the map. (the "index" term is a
    // bit overloaded). We could get away with storing the scope as a map, but
    // SOMETIMES the order matters, SQL-style...
    updateScopeIndex() {
        // Query scope overrides global scalars
        this.scopeIndex = Object.assign({}, this._scalarRefs, this.scope.reduce((memo, col) => {
            assert(col, "Empty column in scope")
            assert(col.ref, "Missing ref in " + JSON.stringify(col, null))
            if (col.relname) {
                if (memo[col.name] !== undefined) {
                    memo[col.name] = AMBIGUOUS
                } else {
                    memo[col.name] = col
                }

                memo[col.relname + '.' + col.name] = col
            } else {
                // if the column doesn't have a fully qualified name, i.e. it's
                // local, it must be clobber existing things with the same name
                // and not be ambiguous
                memo[col.name] = col
            }

            return memo
        }, {}))
    }

    dumpScope() {
        return util.inspect(this.scope, { depth: 3 })
    }
}
