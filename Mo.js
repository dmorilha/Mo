#!/usr/bin/env node

(function () {
    'use strict';

    var buffer = require('buffer'),
        fs = require('fs'),
        stream = require('stream'),
        util = require('util'),
        vm = require('vm'),

        STATE = {
            ENTERING_INITIAL: 0x0,
            INITIAL: 0x1,
            OPEN_CURLY_BRACKET: 0x2,
            ENTERING_EVALUATION: 0x3,
            EVALUATION: 0x4,
            CLOSE_CURLY_BRACKET: 0x5
        },

        TOKEN = {
            OPEN_CURLY_BRACKET: '{'.charCodeAt(0),
            CLOSE_CURLY_BRACKET: '}'.charCodeAt(0)
        };

    function MoParser() {
        var buffer,
            curlyBracketCounter,
            self = this,
            state = STATE.ENTERING_INITIAL;

        stream.apply(this, arguments);

        this.on('pipe', function (readableStream) {
            var self = this;

            readableStream.on('data', function (data) {
                var b,
                    c,
                    h,
                    l,
                    o,
                    s,
                    t1,
                    t2;

                if (!data) {
                    return;
                }

                if (buffer) {
                    b = new Buffer(buffer.length + data.length);

                    buffer.copy(b);
                    data.copy(b, buffer.length);

                    buffer = null;

                } else {
                    b = new Buffer(data.length);
                    data.copy(b);
                }

                l = b.length;
                h = t2 = t1 = 0;

                while (t1 < l) {
                    c = b[t1];

                    switch (state) {

                    case STATE.ENTERING_INITIAL:

                        self.emit('data', {
                            type: 'evaluation',
                            data: b.slice(h, t2).toString('utf-8')
                        });

                        curlyBracketCounter = 0;
                        state = STATE.INITIAL;
                        h = t2 = t1;
                        break;

                    case STATE.ENTERING_EVALUATION:

                        self.emit('data', {
                            type: 'initial',
                            data: b.slice(h, t2).toString('utf-8')
                        });

                        state = STATE.EVALUATION;
                        h = t2 = t1;
                        break;

                    case STATE.OPEN_CURLY_BRACKET:

                        if (c === TOKEN.OPEN_CURLY_BRACKET) {

                            t1++;
                            curlyBracketCounter++;

                            if (curlyBracketCounter === 3) {
                                state = STATE.ENTERING_EVALUATION;
                            }

                        } else {
                            state = STATE.ENTERING_INITIAL;
                        }

                        break;

                    case STATE.EVALUATION:

                        if (c === TOKEN.CLOSE_CURLY_BRACKET) {
                            t2 = t1 - 1;
                            state = STATE.CLOSE_CURLY_BRACKET;

                        } else {
                            t1++;

                            if (c === TOKEN.OPEN_CURLY_BRACKET) {
                                curlyBracketCounter++;
                            }

                        }

                    case STATE.CLOSE_CURLY_BRACKET:

                        if (c === TOKEN.CLOSE_CURLY_BRACKET) {

                            t1++;
                            curlyBracketCounter--;

                            if (curlyBracketCounter) {
                                state = STATE.ENTERING_INITIAL;
                            }

                        } else {

                            if (curlyBracketCounter < 3) {
                                throw new Error('Something is wrong with your template.');
                            }

                            state = STATE.EVALUATION;
                        }

                    default:
                        if (c === TOKEN.OPEN_CURLY_BRACKET) {
                            t2 = t1;
                            state = STATE.OPEN_CURLY_BRACKET;

                        } else {
                            t1++;
                        }

                        break;
                    }
                }

                switch (state) {

                case STATE.ENTERING_INITIAL:
                    self.emit('data', {
                        type: 'evaluation',
                        data: b.slice(h, t1).toString('utf-8')
                    });

                    h = t2 = t1;
                    state = STATE.INITIAL;
                    break;

                case STATE.ENTERING_EVALUATION:
                    self.emit('data', {
                        type: 'initial',
                        data: b.slice(h, t1).toString('utf-8')
                    });

                    h = t2 = t1;
                    state = STATE.EVALUATION;
                    break;

                case STATE.INITIAL:
                    self.emit('data', {
                        type: 'initial',
                        data: b.slice(h, t1).toString('utf-8')
                    });

                    h = t2 = t1;
                    break;
                }
            });
        });
    }

    util.inherits(MoParser, stream);

    MoParser.prototype.end = function () {
        this.emit('end', {});
    };

    var FUNCTION_STATE = {
        IGNORE: 0x0,
        INITIAL: 0x1,
        IDENTIFIER: 0x2,
        STRING: 0x3,
        STRING_ESCAPE: 0x4
    };

    function MoFunctionParser() {
        this._identifier = [];

        this._on = {
            data: [],
            end: []
        };

        this._state = FUNCTION_STATE.IGNORE;
        this._string = [];
    }

    MoFunctionParser.prototype = {
        on: function (e, cb) {
            //TODO: make sure cb is a function
            switch (e) {
            case 'data':
                this._on.data.push(cb);
                break;

            case 'end':
                this._on.end.push(cb);
                break;
            }
        },

        parse: function (s, i) {
            var n;

            function trigger(o, e) {
                var a = Array.prototype.slice.call(arguments, 2);

                switch (e) {
                case 'data':
                case 'end':
                    o._on[e].forEach(function (c) {
                        c.apply(null, a);
                    });
                    break;
                }
            }

            i = {
                i: i
            };

            s.toString().split('').forEach(function (c) {
                switch (this._state) {
                case FUNCTION_STATE.IGNORE:
                    if (c === '[') {
                        this._state = FUNCTION_STATE.INITIAL;
                    }
                    break;

                case FUNCTION_STATE.INITIAL:
                    switch (c) {
                    case "'":
                        this._state = FUNCTION_STATE.STRING;
                        break;

                    case ']':
                        if (this._string.length) {
                            trigger(this, 'data', {
                                data: this._string.join(''),
                                type: 'initial'
                            });

                            this._string = [];
                        }

                        trigger(this, 'end');
                        this._state = FUNCTION_STATE.IGNORE;
                        break;

                    case "i":
                        this._state = FUNCTION_STATE.IDENTIFIER;
                        this._identifier.push(c);
                        break;
                    }
                    break;

                case FUNCTION_STATE.STRING_ESCAPE:
                    this._string.push(c);
                    this._state = FUNCTION_STATE.STRING;
                    break;

                case FUNCTION_STATE.STRING:
                    switch (c) {
                    case "'":
                        this._state = FUNCTION_STATE.INITIAL;
                        return;

                    case '\\':
                        this._state = FUNCTION_STATE.STRING_ESCAPE;
                        break;
                    }
                    this._string.push(c);
                    break;

                case FUNCTION_STATE.IDENTIFIER:
                    if (c === ',') {
                        n = i;

                        this._identifier.join('').split('.').forEach(function (i) {
                            if (n) {
                                n = n[i];
                            }
                        });

                        if (!n) {
                            if (this._string.length) {
                                trigger(this, 'data', {
                                    data: this._string.join(''),
                                    type: 'initial'
                                });

                                this._string = [];
                            }

                            trigger(this, 'data', {
                                data: this._identifier.slice(2).join(''),
                                type: 'evaluation'
                            });

                        } else {
                            this._string.push(n);
                        }

                        this._identifier = [];
                        this._state = FUNCTION_STATE.INITIAL;

                    } else {
                        this._identifier.push(c);
                    }
                    break;
                }
            }, this);
        }
    };

    function Mo () {
    }

    function tab(n) {
        var spaces = [],
            i;

        for (i = n * 4; i > 0; i--) {
            spaces.push(' ');
        }

        return spaces.join('');
    }

    Mo.prototype = {

        parseString: function (s) {
            return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/'/g, '\\\'');
        },

        compileString: function (s, i, cb) {
            var moParser = new MoFunctionParser(),
                keys = [],
                line = [];

            moParser.on('data', function (o) {
                var a = [],
                    b = [],
                    c,
                    l;

                switch (o.type) {

                case 'initial':
                    if (o.data) {
                        line.push("'" + o.data.toString() + "'");
                    }

                    break;

                case 'evaluation':
                    if (o.data) {
                        keys.push(o.data);
                        line.push('i.' + o.data);
                    }

                    break;
                }
            });

            moParser.on('end', function () {
                var lines = [];

                lines.push('(function () {');
                lines.push('return {');
                lines.push(tab(1) + 'expand: function (i) {');
                lines.push(tab(1) + 'return [' + line.join(', ') + '];');
                lines.push(tab(1) + '},');
                lines.push();
                lines.push(tab(1) + 'keys: ' + JSON.stringify(keys));
                lines.push('};');
                lines.push('})();');

                cb({
                    code: lines.join('\n')
                });
            });

            moParser.parse(s, i);
        },

        compileFile: function (file, cb) {
            var readableStream = fs.createReadStream(file),
                self = this;

            readableStream.on('open', function () {
                var moParser = new MoParser(),
                    keys = [],
                    line = [];

                moParser.on('data', function (o) {
                    var a = [],
                        b = [],
                        c,
                        l;

                    switch (o.type) {

                    case 'initial':
                        if (o.data) {
                            line.push("'" + self.parseString(o.data.toString()) + "'");
                        }

                        break;

                    case 'evaluation':
                        if (o.data) {
                            keys.push(o.data);
                            line.push('i.' + o.data);
                        }

                        break;
                    }
                });

                moParser.on('end', function () {
                    var lines = [];

                    lines.push('(function () {');
                    lines.push('return {');
                    lines.push(tab(1) + 'expand: function (i) {');
                    lines.push(tab(1) + 'return [' + line.join(', ') + '];');
                    lines.push(tab(1) + '},');
                    lines.push();
                    lines.push(tab(1) + 'keys: ' + JSON.stringify(keys));
                    lines.push('};');
                    lines.push('})();');

                    cb({
                        code: lines.join('\n')
                    });
                });

                readableStream.pipe(moParser);
            });
        }
    };

    var m = new Mo();

    m.compileFile('./template', function (o) {
        var i,
            y,
            z;

        z = vm.runInThisContext(o.code);

        y = {
        };

        m.compileString(z.expand, y, function (o) {
            var i,
                y,
                z;

            z = vm.runInThisContext(o.code);

            console.error(z.expand.toString());

            y = {
                a: {
                    a: 'foo',
                    b: 'bar',
                    c: 'baz'
                },
                b: 'foz',
                c: ''
            };

            for (i = 0; i < 1000000; i++) {
                z.expand(y).join('');
            }

            console.log(z.expand(y).join(''));
        });
    });
}());
