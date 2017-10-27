module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": "eslint:recommended",
    "rules": {
        "indent": [
            "warn",
            4
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
        "quotes": 0/*[
            "warn",
            "double"
        ]*/,
        "semi": [
            "warn",
            "never"
        ]
    }
};