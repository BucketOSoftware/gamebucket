// Functions that take multiple rows and return one/fewer

const { evaluate } = require('../query')
const es = require('../es')

function any(args, steps, env) {
    // group stmt aspects:
    //  - initializers
    //  - onRow
    //  - afterRows (after the interior steps)
    let onRow = () => ({ type: 'ReturnStatement', argument: es.literal(true) })

    let afterRows = {
        type: 'ReturnStatement',
        argument: es.literal(false)
    }

    return es.enblock(
        evaluate(steps.concat(onRow), env),
        afterRows
    )
}

module.exports = { any }