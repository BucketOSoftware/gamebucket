function {{klass}}() {
    this._data = [
    {{#initialData}}
        { {{.}} },
    {{/initialData}}
    ];

    this._indices = [
    {{#indices}}
        new UniqueIndex({{cols}}),
    {{/indices}}
    ]

    var tbl = this;

    // TODO: this does not handle vector columns
    this._proxy = {
        // TODO: make "save" a reserved word, or...
        save: function() {
            tbl._willRemove(this._$row);
            {{#columns}}
            if (this._{{name}} !== undefined) {
                this._$row.{{name}} = this._{{name}};
            }
            {{/columns}}
            tbl._didInsert(this._$row);
            this._$row = undefined;
            this.reset();
        },
        reset: function() {
            {{#columns}}
            this._${{name}} = undefined;
            {{/columns}}
        },
        _$row: undefined,
        {{#columns}}
        _{{name}}: undefined,
        {{/columns}}
    }

    {{#columns}}
    Object.defineProperty(this._proxy, '{{name}}', {
        get: function() {
            return this._{{name}} === undefined
                ? this._$row.{{name}}
                : this._{{name}}
        },
        set: function(val) {
            {{#isVector}} throw new Error("NO VECTORS") {{/isVector}}

            if (val === this._$row.{{name}}) { return; }
            $typeassert("{{type}}", val);
            this._{{name}} = val;
        },
    })
    {{/columns}}

}

{{klass}}.prototype._didInsert = function(row) {
    for (var i = 0; i < {{indices.length}}; i++) {
        var index = this._indices[i];
        // TODO: handle multiple columns
        index.addRow(index.hash(row[index.cols[0]]), row)
    }

}

{{klass}}.prototype._willRemove = function(row) {
    for (var i = 0; i < {{indices.length}}; i++) {
        var index = this._indices[i];
        // TODO: handle multiple columns
        index.removeRow(index.hash(row[index.cols[0]]), row)
    }
}

/*
// Problem: if an update doesn't change any of the columns covered by an index,
// we can save the remove/insert. However, we'd need to sandwich the save
// callback -- we don't want to insert the proxy row into the table!
{{klass}}.prototype._willChange = function(newRow, oldRow) {
    for (var i = 0; i < {{indices.length}}; i++) {
        var index = this._indices[i],
            // TODO: handle multiple columns
            oldHash = index.hash(oldRow[index.cols[0]]),
            newHash = index.hash(newRow[index.cols[0]])
        if (oldHash !== newHash) {
            index.removeRow(oldHash, oldRow)
        }
    }
}
*/

{{klass}}.prototype.count = function() {
    return this._data.length;
}


{{#insert}}
{{klass}}.prototype.insert = function({{args}}) {
    // TODO: pooling

    // Check types
    {{#expandedCols}}
    $typeassert("{{type}}", {{name}});
    {{/expandedCols}}
    
    // Allocate vectors
    {{#columns}}
    {{#isVector}}
    var {{name}} = new {{constructor}}({{length}});
    {{/isVector}}
    {{/columns}}

    {{#expandedCols}}
        {{#vector}}
            {{vector}}[{{idx}}] = {{name}};
        {{/vector}}
    {{/expandedCols}}

    var newRow = {
        {{#columns}}
        {{name}}: {{name}},
        {{/columns}}
    };

    this._data.push(newRow);
    this._didInsert(newRow);

    return newRow;
}
{{/insert}}



{{klass}}.prototype.update = function(handle) {
    return handle; //proxyobj
}

{{klass}}.prototype.destroy = function(handle) {
    var idx = this._data.indexOf(handle), len = this._data.length;
    if (idx === -1) {
        throw new Error("Row not found");
    }

    this._willRemove(this._data[idx])

    // swap 'n' pop
    this._data[idx] = this._data[len - 1];
    this._data.pop();

    // May or may not be slower. Definitely messes with positioning more
    // this._data.splice(idx, 1);

}


{{klass}}.prototype.updateAll = function(callback) {
    for (var idx = 0; idx < this._data.length; idx++) {
        this._proxy._$row = this._data[idx];
        this._proxy.reset();
        callback(this._proxy);
    }
}

{{klass}}.prototype.destroyWhere = function(callback) {
    for (var idx = 0; idx < this._data.length; idx++) {
        var row = this._data[idx];
        if (callback({{callbackArgs}})) {
            this._willRemove(row);

            this._data[idx] = this._data[this._data.length - 1];
            this._data.pop();
            idx--;
        }
    }
}

{{klass}}.prototype.forEach = function(callback) {
    for (var i = 0; i < this._data.length; i++) {
        var row = this._data[i];
        callback({{callbackArgs}});
    }
}
