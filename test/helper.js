global.td = require('testdouble');
const tdChai = require('testdouble-chai');
const chai = require('chai');
chai.use(tdChai(td));
global.expect = chai.expect;

const _eval = require("eval");
const compiler = require("../src/compiler");

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const sanitize = require('sanitize-filename');

exports.setTestName = function() {
    global.TEST_NAME = this.currentTest.fullTitle();
}

exports.compile = function(code, { modules={}, fileContents }={}) {
    let compiled = compiler.compile(code, fileContents);

    let debugFile = sanitize(global.TEST_NAME).replace(/\W+/g, '-') + '.js';

    if (process.env.WRITE_DEBUG > 0) {
        mkdirp.sync('debug')
        fs.writeFileSync(path.join('debug', debugFile), compiled)
    }

    let jsCode = _eval(compiled, {
        console: console,
        require: module => {
            if (!modules[module]) {
                throw new Error("No module named " + module)
            }
            return modules[module]
        },
    })
    return new jsCode()
}

exports.sortNumbers = function(a, b) { return a - b; }
