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
                    lines = [],
                    t = 0;

                lines.push('function (i) {');
                lines.push(tab(1) + 'var l = [];');
                lines.push('');

                moParser.on('data', function (o) {
                    var a = [],
                        b = [],
                        l;

                    switch (o.type) {

                    case 'initial':
                        if (o.data) {
                            lines.push(tab(1) + 'l.push(\'' + self.parseString(o.data.toString()) + '\');');
                            lines.push('');
                        }

                        break;

                    case 'evaluation':
                        if (o.data) {
                            a = o.data.split('.');
                            a.unshift('i');

                            for (i = 2, l = a.length; i <= l; i++) {
                                b.push(a.slice(0, i).join('.'));
                            }

                            lines.push(tab(1) + 'if (' + b.join(' && ') + ') {');
                            lines.push(tab(2) + 'l.push(' + b[l - 2] + '.toString());');
                            lines.push(tab(1) + '}');
                            lines.push('');
                        }

                        break;
                    }
                });

                moParser.on('end', function () {
                    lines.push(tab(1) + 'return l.join(\'\');');
                    lines.push('}');

                    cb({
                        code: lines.join('\n')
                    });
                });

                readableStream.pipe(moParser);
            });
        }
    };

    (new Mo).compile('./template', function (o) {
        var c,
            i,
            y,
            z;

        c = 'assignTemplate(' + o.code + ');';

        vm.runInNewContext(c, {
            assignTemplate: function (f) {
                z = f
            }
        });

        y = {
            a: {
                a: 'foo',
                b: 'bar',
                c: 'baz'
            },
            b: 'foz'
        };

        for (i = 0; i < 1000; i++) {
            z(y);
        }
    });
}());
