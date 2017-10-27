// Some helpers for constructing estree chunks -- probably deprecated in favor
// of the more consistent and NIH ast-types
const parse = require('esprima').parse
const flatMap = require('lodash/flatMap')

exports.stmt = function(javascript) {
    return parse(javascript).body[0]
}

exports.wrapExpression = function(expression) {
    return { type: 'ExpressionStatement', expression }
}

exports.empty = function() {
    return { type: 'EmptyStatement' };
};

exports.literal = function(value) {
    return { type: "Literal", value: value };
};

exports.identifier = function(name) {
    return {
        type: "Identifier",
        name: name
    };
};

exports.not = function(expr) {
    return {
        type: "UnaryExpression",
        operator: "!",
        prefix: true,
        argument: expr,
    }
}

exports.set = function(variable, value) {
    return {
        type: "ExpressionStatement",
        expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: variable,
            right: (typeof value === 'object') ? value : exports.literal(value),
        }
    }
}

exports.call = function(name, argArray) {
    return {
        type: "ExpressionStatement",
        expression: {
            type: "CallExpression",
            callee: exports.identifier(name),
            arguments: argArray,
        }
    }
}

exports.var = function(name, init) {
    return {
        type: "VariableDeclaration",
        kind: "var",
        declarations: [{
            type: "VariableDeclarator",
            id: name,
            init: (typeof init === 'object') ? init : exports.literal(init)
        }],
    }
}


function memberInternal(object, property, computed) {
    return {
        type: "MemberExpression",
        computed: computed,
        object: object,
        property: (typeof property !== 'string'
                    ? property
                    : exports.identifier(property)),
    }
}

exports.member = {
    dot: function(object, property) {
        return memberInternal(object, property, false);
    },
    brackets: function(object, property) {
        return memberInternal(object, property, true);
    }
};

exports.enblock = function(...statements) {
    switch(statements.length) {
    case 0:
        return exports.empty();
    case 1:
        return statements[0];
    default:
        return {
            type: 'BlockStatement',
            body: flatMap(statements, stmt => {
                if (stmt.type === 'BlockStatement') {
                    return stmt.body
                } else if (stmt.type === 'EmptyStatement') {
                    return []
                } else {
                    return stmt
                }
            })
        }
    }
}

// all args are estree ASTs
exports.simpleFor = function({ counter, iterations, length, body }) {
    return {
        type: "ForStatement",
        init: {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: counter,
                    init: exports.literal(0),
                },
                {
                    type: "VariableDeclarator",
                    id: length,
                    init: iterations
                },
            ],
        },
        test: {
            type: "BinaryExpression",
            operator: "<",
            left: counter,
            right: length,
        },
        update: {
            type: "UpdateExpression",
            operator: "++",
            argument: counter,
            prefix: false
        },
        body: body
    }
}
