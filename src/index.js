// Simple frontend to the compiler

const fs = require("fs")
// require('coffee-script/register')

const path = require('path')
// const util = require('util');
// const parser = require('./parser');
const compiler = require('./compiler');


let sourcefile = process.argv[2]
let code = fs.readFileSync(sourcefile, 'utf8').toString()

function fileContents(file) {
    // Find the file relative to the source
    return fs.readFileSync(path.join(path.dirname(sourcefile), file))
}

process.stdout.write(compiler.compile(code, fileContents))