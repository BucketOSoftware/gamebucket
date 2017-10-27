'use strict';

/*
 * Indexes
 */

// DONTYET: omit from source if nothing uses a unique index
function UniqueIndex(cols) {
    this.cols = cols; // TODO: copy?
    this.map = {};
}

UniqueIndex.prototype.hash = function(v) { return v.toString(); }

UniqueIndex.prototype.addRow = function(hash, row) {
    if (hash === undefined) { throw new Error('invalid hash key') }

    if (this.map[hash]) {
        throw new Error("Duplicate row: " + row.toString())
    }
    this.map[hash] = row;
}

UniqueIndex.prototype.removeRow = function(hash/*, row */) {
    this.map[hash] = undefined;
}

UniqueIndex.prototype.get = function(hash) { return this.map[hash]; }

/*
 *
 */

var queuedDeletes = [];
function flushDeletes(bucket) {
    var cmd;
    while (cmd = queuedDeletes.pop()) {
        bucket[cmd.t].destroy(cmd.r)
    }
}

{{#imports}}
var {{localname}} = require("{{import}}")
{{/imports}}

{{#privateVars}}
var {{name}} = {{init}};
{{/privateVars}}

function $typeassert(type, value) {
    switch(type) {
        case 'Int':
            if (typeof value === 'number' && (value|0) === value) { return; }
            break;
        case 'Float32':
        case 'Number':
            if (typeof value === 'number' && isFinite(value)) { return; }
            break;
        {{#enumTypes}}
        case '{{name}}':
            if (Bucket.prototype.{{name}}.indexOf(value) !== -1) { return; }
            break;
        {{/enumTypes}}
        default:
            throw new Error("Unknown type " + type);
    }
    throw new TypeError("Value " + value + " is not of type " + type);
}

{{#codeChunks}}
{{.}}
{{/codeChunks}}

function Bucket() {
    var that = this;
    {{#constructorProps}}
    {{.}}
    {{/constructorProps}}

    {{#scalars}}
    this.{{privName}} = {{init}}
    Object.defineProperty(this, '{{name}}', {
        get: function() { return that.{{privName}} },
        {{#mutable}}
        set: function(v) { $typeassert("{{type}}", v); that.{{privName}} = v }
        {{/mutable}}
        {{^mutable}}
        set: function() { throw new Error("{{name}} is a constant") }
        {{/mutable}}
    })
    {{/scalars}}
};

/* prototype properties */
{{bucketPrototype}}

{{#enumTypes}}
Bucket.prototype.{{name}} = [{{#values}}'{{.}}',{{/values}}]
{{/enumTypes}}

Bucket.prototype.dump = function() {
    {{#tables}}
    console.log(JSON.stringify({ {{.}}: this.{{.}}._data }))
    {{/tables}}
}

module.exports = Bucket;
