const _ = require('lodash')
const assert = require('assert')
const flatMap = require('lodash/flatMap')
const es = require('../es')
const esb = require('ast-types').builders

module.exports = {
    steps: joinSteps,
}

// Return an AST to perform a natural join between the current scope and tbl
function joinSteps(env, tbl, scopeForRelation) {
    let { ident:otherTableName, alias } = tbl
    alias = alias || otherTableName

    let leftCols = env.scope,
        rightCols = scopeForRelation(otherTableName, env),
        [joinCols, leftOnlyCols, rightOnlyCols] = venn(leftCols, rightCols)

    if (joinCols.length < 1) {
        throw new Error(`join: No common columns in ${otherTableName} ('${
            _.map(rightOnlyCols, 'name').join(', ')
        }' vs. '${
            _.map(leftOnlyCols, 'name').join(', ')
        }')`)
    }

    let index = env.getIndex(otherTableName, joinCols)
    if (index) {
        return useIndex(env, index, joinCols, leftOnlyCols, rightOnlyCols)
    } else {
        return useTableScan(tbl, alias, joinCols, leftOnlyCols, rightOnlyCols)
    }
}

function useIndex(env, index, joinCols, leftOnlyCols, rightOnlyCols) {
    // For now, we can assume that the column covers all the join columns.
    // That won't always be the case.
    //
    // We're also going to have to make sure we feed the columns into the hash
    // function in the right order, when there can be more than one.

    return [function(env, next, evaluate) {
        // cache the hache!
        let hash = esb.identifier(env.uniqueVar('hash')),
            indexedRow = es.identifier(env.uniqueVar('indexedRow'))

        let cacheHache = esb.variableDeclaration('var', [
            esb.variableDeclarator(
                hash,
                esb.callExpression(
                    es.member.dot(index, es.identifier('hash')),
                    joinCols.map(c => c.ref)
                )
            ),
            esb.variableDeclarator(
                indexedRow,
                esb.callExpression(
                    es.member.dot(index, es.identifier('get')),
                    [hash]
                )
            )

        ])

        let newScope = joinCols.concat(leftOnlyCols, rightOnlyCols.map(col => {
            return Object.assign({}, col, {
                ref: es.member.dot(indexedRow, esb.identifier(col.name))
            })
        }))

        return es.enblock(
            cacheHache,
            esb.ifStatement(indexedRow,
                es.enblock(evaluate(next, env.replaceScope(newScope)))
            )
        )
    }]
}

function useTableScan(tbl, alias, joinCols, leftOnlyCols, rightOnlyCols) {
    return [
        { func: 'product', args: [tbl] },
        joinWhereStep(joinCols, alias),
        joinProjectStep(joinCols, leftOnlyCols, rightOnlyCols, alias),
    ]
}

function venn(left, right) {
    return [
        commonColumns(left, right),
        // left only
        differenceColumns(left, right),
        // right only
        differenceColumns(right, left),
    ]
}

function joinComp(a, b) {
    if (a.type === undefined || b.type === undefined) {
        // kludge: allow match on name if we don't know the types
        return a.name === b.name
    }

    return a.name === b.name &&
        a.type === b.type &&
        a.length === b.length
}

// returns the 'project' command that forms the end of a join op
function joinProjectStep(commonCols, leftCols, rightCols, rightAlias) {
    let projectArgs = commonCols.concat(leftCols).map(({name, relname}) => {
        assert(relname)
        return {
            ident: _.isNil(relname) ? name : `${relname}.${name}`,
            alias: name,
        }
    })

    projectArgs = projectArgs.concat(rightCols.map(col => ({
        ident: `${rightAlias}.${col.name}`,
        alias: col.name,
    })))

    return { func: 'project', args: projectArgs }
}

function typeComparator(type) {
    switch(type) {
    default:
        return '==='
    }
}

function joinWhereStep(commonCols, alias) {
    return { func: 'where', args: [{ javascript: whereCond(commonCols, alias) }] }
}

function whereCond(commonCols, alias) {
    return flatMap(commonCols, ({ name, relname, type, length }) => {
        assert(relname)
        let comp = typeComparator(type) // FIXME: not guaranteed to work if we matched permissively

        if (length) {
            return _.map(
                _.times(length),
                n => `${relname}.${name}[${n}] ${comp} ${alias}.${name}[${n}]`
            )
        }

        return `${relname}.${name} ${comp} ${alias}.${name}`
    }).join(" && ")
}

function commonColumns(leftColumns, rightColumns) {
    return _.intersectionWith(leftColumns, rightColumns, joinComp)
}

function differenceColumns(inThisOne, butNotThisOne) {
    return _.differenceWith(inThisOne, butNotThisOne, joinComp)
}
