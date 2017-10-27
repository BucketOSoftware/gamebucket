const estraverse = require('estraverse')
const assert = require('assert')
const util = require('util')

const AMBIGUOUS = Object.freeze({ ambiguous: true })

module.exports = { resolveIdentifiers, findNames, AMBIGUOUS }

function findNames(ast) {
    let namesFound = []
    estraverse.traverse(ast, {
        enter: function(node) {
            if (node.type === 'Identifier') {
                namesFound.push(node.name)
            } else if (node.type === 'MemberExpression' && !node.computed) {
                let dottedName = node.object.name + '.' + node.property.name
                namesFound.push(dottedName)
                this.skip()
            }
        }
    })
    return namesFound
}

// resolve identifiers within the scope in `env`
// this is meant to be used on just-parsed JS chunks
function resolveIdentifiers(ast, env) {
    estraverse.replace(ast, {
        enter: function(node /*, parent*/) {
            if (node.type === 'MemberExpression' && !node.computed) {
                // [dot]qualified name
                assert.equal(false, node.computed)
                assert.equal('Identifier', node.object.type)
                assert.equal('Identifier', node.property.type)

                // this makes a lot of assumptions that the name isn't computed, etc.
                let dottedName = node.object.name + '.' + node.property.name

                assert.notStrictEqual(AMBIGUOUS, env.scopeIndex[dottedName])
                // TODO: change 'get' so it'll return a reasonable thing for e.g. Math.pow
                if (env.get(dottedName)) {
                    this.skip()
                    if (env.scopeIndex[dottedName]) {
                        return env.scopeIndex[dottedName].ref
                    } else {
                        return
                    }
                } else {
                    throw new Error("Unknown reference: " + dottedName)
                    // this.skip()
                }
            } else if (node.type === 'Identifier') {
                let replacement = env.scopeIndex[node.name]
                if (replacement) {
                    assert.notStrictEqual(AMBIGUOUS, replacement, `Ambiguous reference: ${node.name}`)
                    assert(replacement.ref.type)

                    this.skip()
                    return replacement.ref
                }

                if (env.isLocalName(node.name)) {
                    return this.skip()
                    // return
                }

                throw new Error("Unknown name: " + node.name)
            }
        }
    })
}