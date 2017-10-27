const path = require('path');
const fs = require("fs");
const jison = require("jison");

const ebnfParser = require('ebnf-parser');
const lexParser = require('lex-parser');

const files = {
    grammar: fs.readFileSync(path.join(__dirname, "bucket.jison"), "utf8"),
    lex: fs.readFileSync(path.join(__dirname, "bucket.lex"), "utf8"),
}

const grammar = ebnfParser.parse(files.grammar);
grammar.lex = lexParser.parse(files.lex);

// console.log(JSON.stringify(grammar));

let parser = new jison.Parser(grammar, { moduleType: "commonjs" });

module.exports = parser;