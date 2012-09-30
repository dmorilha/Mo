#!/usr/bin/env node

(function () {
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

    function MoFunctionParser() {
        this._on = {
            data: []
        };

        this._state = STATE.ENTERING_INITIAL;
    }

    MoFunctionParser.prototype = {
        on: function (e, cb) {
            switch (e) {
            case 'data':
                this._on.data.push(cb);
                break;
            }
        },

        parse: function (s) {
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

        compile: function (file, cb) {
            var readableStream = fs.createReadStream(file),
                self = this;

            readableStream.on('open', function () {
                var moParser = new MoParser(),
                    keys = [],
                    line = [],
                    lines = [],
                    t = 0;

                lines.push('(function () {');
                lines.push('return {');
                lines.push(tab(1) + 'expand: function (i) {');

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
                            line.push('i.' + o.data + '.toString()');
                        }

                        break;
                    }
                });

                moParser.on('end', function () {
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

    (new Mo).compile('./template', function (o) {
        var i,
            z;

        z = vm.runInThisContext(o.code);

        y = {
            a: {
                a: 'foo',
                b: 'bar',
                c: 'baz'
            },
            b: 'foz',
            c: ''
        };

        console.error(z.expand.toString());

        for (i = 0; i < 1000000; i++) {
            z.expand(y).join('');
        }

        console.log(z.expand(y).join(''));
    });
}());
