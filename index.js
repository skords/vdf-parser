// a simple parser for Valve's KeyValue format
// https://developer.valvesoftware.com/wiki/KeyValues
//
// author: Rossen Popov, 2014-2016
// contributor: Tom Shaver, 2017
// updated by: Yug Kapoor, 2019

const request = require('request');
const path = require('path');

function getFile(file) {
  return new Promise((resolve, reject) => {

    console.log("Downloading: "  + file);
    request(file, (err, res, body) => {
          if (err) console.log(err), cli.error("Unable to download: " + file);
          console.log("Download complete.");
          resolve( body );
    });

  }); 
};

function cleanString(input) {
    var output = "";
    for (var i=0; i<input.length; i++) {
        if (input.charCodeAt(i) <= 127 && input.charCodeAt(i) > 0) {
            output += input.charAt(i);
        }
    }
    return output;
}


// duplicate token can be undefined. If it is, checks are skipped later on.
// it is expected for DUPLICATE_TOKEN to be a string identifier appended to
// duplicate keys
async function parse (text, filePath, DUPLICATE_TOKEN) {
  if (typeof text !== 'string') {
    throw new TypeError('VDF.parse: Expecting text parameter to be a string')
  }

  // If duplicate token exists AND is not a string
  if (DUPLICATE_TOKEN && typeof DUPLICATE_TOKEN !== 'string') {
    throw new TypeError('VDF.parse: Expecting DUPLICATE_TOKEN parameter to be a string if defined')
  }


  var lines = text.split('\n')

  var obj = {}
  var stack = [obj]
  var expectBracket = false
  var samelineBracket = false
  var line = ''
  var m = ''
  var externals = [];

  var reKV = new RegExp(
    '^("((?:\\\\.|[^\\\\"])+)"|([a-z0-9\\-\\_]+))' +
    '([ \t]*(' +
    '"((?:\\\\.|[^\\\\"])*)(")?' +
    '|([a-z0-9\\-\\_]+)' +
    '))?'
  )

  var i = 0
  var j = lines.length

  for (; i < j; i++) {
    line = cleanString(lines[i]).trim()

    // skip empty and comment lines
    if (line === '' || line[0] === '/') {
      continue
    }

    // todo, implement case for handling #base 'includdes' that will
    // import another ENTIRE file to import documents with.

    // implemented for now to stop system from erroring out.
    if(line[0] === '#' ) {
      console.log("Importing:" + line.replace('#base ', ''));
      if ( filePath && line.indexOf("#base") > -1 ) {       
        externals.push( await parse( await getFile(  path.dirname(filePath) + '/' + line.replace('#base ', '') ) ) );
      }
      console.log("Import complete.");
      continue
    }

     if (line.indexOf('"REMOVE"') > -1) {
      continue
    }

    // one level deeper
    if (line[0] === '{') {
      expectBracket = false
      continue
    }

    if (line.includes('{')) {
      line = line.replace('{', '')
      samelineBracket = true
    }

    if (expectBracket) {
      throw new SyntaxError('VDF.parse: expected bracket on line ' + (i + 1) + "line:" + line)
    }

    // one level back
    if (line[ 0 ] === '}') {
      stack.pop()
      continue
    }


    let done = false

    // parse keyvalue pairs
    while (!done) {
      m = reKV.exec(line)

      if (m === null) {
        throw new SyntaxError('VDF.parse: invalid syntax on line ' + (i + 1))
      }

      // qkey = 2
      // key = 3
      // qval = 6
      // vq_end = 7
      // val = 8
      var key = (typeof m[ 2 ] !== 'undefined') ? m[ 2 ] : m[ 3 ]
      var val = (typeof m[ 6 ] !== 'undefined') ? m[ 6 ] : m[ 8 ]

      if (typeof val === 'undefined') {
        // this is a duplicate key so we need to do special increment
        // check to see if duplicate token is declared. if it's undefined, the user didn't set it/
        // so skip this below operation. instead, proceed to the original behavior of merging.
        if(DUPLICATE_TOKEN && stack[stack.length -1][ key ]) {
          // if we are in here, the user has opted for not overriding duplicate keys

          // we don't know how many duplicate keys exist, so we have to while loop
          // and check our increments.
          let newKeyFound = false; // by default, no idea where we are
          let int = 2; // start at 2, the unmodified first one is "1".
          let base = key; // the base of what the key variable should have each time
          
          while(!newKeyFound) { 
            key = base + `-${DUPLICATE_TOKEN}-${int}`; // what the key shoud look like

            // if this key has an assigned value already, keep going up
            if( stack[stack.length -1][key] ) {
              int++;
              continue;
            // this key does NOT have anything assigned. Assign it.
            } else {
              stack[stack.length -1][key] = {} // assign it
              newKeyFound = true // break loop
            }
          }
        }

        // new key time!
        if (!stack[stack.length - 1][ key ]) {
          stack[stack.length - 1][ key ] = {}
        }

        stack.push(stack[stack.length - 1][ key ])
        expectBracket = true

        if (samelineBracket) {
          expectBracket = false
          samelineBracket = false
        }
      } else {
        if (!m[ 7 ] && !m[ 8 ]) {
          line += '\n' + lines[ ++i ]
          continue
        }

        stack[stack.length - 1][ key ] = val
      }

      done = true
    }
  }

  if (stack.length !== 1) {
    throw new SyntaxError('VDF.parse: open parentheses somewhere')
  }

  for (  key in obj ) {
    for ( external of externals ) {
      if (  external.hasOwnProperty(key) ) {
        obj[key] = {...external[key], ...obj[key]};
      }
    }
  }

  return obj
}

function _dump (obj, pretty, level, DUPLICATE_TOKEN) {
  if (typeof obj !== 'object') {
    throw new TypeError('VDF.stringify: a key has value of type other than string or object')
  }

  var indent = '\t'
  var buf = ''
  var lineIndent = ''

  if (pretty) {
    for (var i = 0; i < level; i++) {
      lineIndent += indent
    }
  }

  for (let key in obj) {
    // the key may not be the /binding/ key, for now we declare a variable
    // and assign it to key.
    // BELOW, with our if statement, we tentatively can change it.
    let finalKey = key
    // if a duplicate token was defined, check to see if this key has it.
    // if it does, override the key in this context with only the original key value by taking index 0
    if(DUPLICATE_TOKEN && key.includes(DUPLICATE_TOKEN)) finalKey = key.split(`-${DUPLICATE_TOKEN}-`)[0]
    
    // in the below section, we update finalKey instead of key in this area because
    // we want the stripped key as the key. BUT, we want the ORIGINAL keys data.
    if (typeof obj[ finalKey ] === 'object') {
      buf += [lineIndent, '"', finalKey, '"\n', lineIndent, '{\n', _dump(obj[key], pretty, level + 1, DUPLICATE_TOKEN), lineIndent, '}\n'].join('')
    } else {
      buf += [lineIndent, '"', finalKey, '"', indent, indent, '"', String(obj[ key ]), '"\n'].join('')
    }
  }

  return buf
}

function stringify (obj, pretty, DUPLICATE_TOKEN) {
  if (typeof obj !== 'object') {
    throw new TypeError('VDF.stringify: First input parameter is not an object')
  }


  if(DUPLICATE_TOKEN && typeof DUPLICATE_TOKEN !== 'string') {
    throw new TypeError('VDF.stringify: Expecting DUPLICATE_TOKEN parameter to be a string if defined')
  }

  pretty = (typeof pretty === 'boolean' && pretty)

  return _dump(obj, pretty, 0, DUPLICATE_TOKEN)
}

exports.parse = parse
exports.dump = stringify
exports.stringify = stringify
