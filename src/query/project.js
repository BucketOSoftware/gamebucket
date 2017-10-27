const assert = require('assert')
const util = require('util')

const parse = require('esprima').parse

const _ = require('lodash')
const map = require('lodash/map')
const pull = require('lodash/pull')
const difference = require('lodash/difference')
const partition = require('lodash/partition')
const includes = require('lodash/includes')

const { findNames, resolveIdentifiers, AMBIGUOUS } = require('./resolve')

const PROJECT_ALL = Object.freeze({ ident: '*' })

module.exports = {
    scopeEntryForProjectColumn,
    scopeEntryForProjectAll,
    scopeEntryForProjectDerived,
    PROJECT_ALL
}

// If args has any interdependencies, return a list of projections that will satisfy them
function prerequisites(args, env) {
    let newCommands = [],
        justAdded, 
        availableNames = env.availableNames() // necessary because that's how we check if we've added names

    const isArgUnmet = arg => argDependencies(arg).filter(name => !(includes(availableNames, name) || !!env.get(name))).length

    let [unmet, met] = partition(args, isArgUnmet)
    while(unmet.length) {
        let newlyMet = difference(met, justAdded)
        justAdded = []
        newlyMet.forEach(arg => {
            let provides = argProvides(arg)
            if (!includes(availableNames, provides)) {
                availableNames.push(provides)

                justAdded.push(arg)
                newCommands.push({ func: 'project', args: [PROJECT_ALL, arg] })
            }
        })

        ; [unmet, met] = partition(args, isArgUnmet)
        if (justAdded.length === 0 && unmet.length > 0) {
            let arg = unmet[0],
                summary = (arg.javascript && arg.javascript.trim()) || arg.ident,
                missing = difference(argDependencies(arg), availableNames).join(', ')
            throw new Error(`Missing names for '${summary}': ${missing}`)
        }
    }

    return newCommands.length && newCommands
}

function argProvides({alias, ident}) {
    return alias || ident || undefined
}

function argRequires({ident, javascript}) {
    if (ident) {
        return [ident]
    } else if (javascript) {
        return findNames(parse(javascript))
    } else {
        return []
    }
}

function argDependencies(arg) {
    let vars = map(arg.vars, 'name')
    
    return pull(argRequires(arg), ...vars)
}

function scopeEntryForProjectColumn(env, colName, alias=colName.split('.').pop()) {
    let scopeEntry = env.scopeIndex[colName]
    if (scopeEntry === AMBIGUOUS) {
        throw new Error("Ambiguous: " + colName)
    }

    assert(scopeEntry, "Nothing for " + colName + " in " + _.map(env.scope, 'name'))
    return Object.assign({}, scopeEntry, { name: alias })
}


function scopeEntryForProjectAll(env, relation) {
    if (relation) {
        let entry = env.scope.filter(col => col.relname === relation)
        assert(entry.length, "No columns in " + relation)
        return entry
    } else {
        return env.scope
    }
}

function scopeEntryForProjectDerived(env, js, localVars, colName=env.uniqueVar('$calc') ) {
    let program

    try {
        program = parse(js)
    } catch (e) {
        throw new Error("Invalid JavaScript expression " + js)
    }

    assert.equal(1, program.body.length)

    if (localVars) { // input vars
        env = env.child()
        env.scopeIndex = _.clone(env.scopeIndex)
        localVars.forEach(({name, type}) => {
            env.scopeIndex[name] = {
                name,
                type: type[0],
                length: type[1],
                relname: null,
                ref: env.newClosure(name, type)
            }
        })
    }
    resolveIdentifiers(program, env)

    let condition = program.body.pop()
    assert(condition.expression, "Last statement of block is not an expression?")

    let col = {
        name: colName,
        relname: '$derived', // placeholder relation name allows us to join to it later
        ref: condition.expression
    }

    if (localVars) {
        // FIXME: localVars should really be "reference variable passed in by GB and expected as output"
        assert.equal(1, localVars.length)
        col.type = localVars[0].type[0],
        col.length = localVars[0].type[1]
    }
    return col
}
