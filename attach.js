const fs = require('fs');

let test = fs.readFileSync('./data/test.zip').buffer;

module.exports = test;
