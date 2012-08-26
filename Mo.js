#!/usr/bin/env node

(function () {

    var
        buffer = require('buffer'),
        fs = require('fs'),
        stream = require('stream'),
        util = require('util'),
        vm = require('vm'),

        STATE = {
            ENTERING_INITIAL: 0x0,
            INITIAL: 0x1,
            OPENING_CURLY_BRACKET: 0x2,
            ENTERING_EVALUATION: 0x3,
            EVALUATION: 0x4,
            CLOSING_CURLY_BRACKET: 0x5
        },

        TOKEN = {
            OPENING_CURLY_BRACKET: '{'.charCodeAt(0),
            CLOSING_CURLY_BRACKET: '}'.charCodeAt(0)
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

                    case STATE.OPENING_CURLY_BRACKET:

                        if (c === TOKEN.OPENING_CURLY_BRACKET) {

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

                        if (c === TOKEN.CLOSING_CURLY_BRACKET) {
                            t2 = t1 - 1;
                            state = STATE.CLOSING_CURLY_BRACKET;

                        } else {
                            t1++;

                            if (c === TOKEN.OPENING_CURLY_BRACKET) {
                                curlyBracketCounter++;
                            }

                        }

                    case STATE.CLOSING_CURLY_BRACKET:

                        if (c === TOKEN.CLOSING_CURLY_BRACKET) {

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
                        if (c === TOKEN.OPENING_CURLY_BRACKET) {
                            t2 = t1;
                            state = STATE.OPENING_CURLY_BRACKET;

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
                        data: b.slice(h, t2).toString('utf-8')
                    });

                    h = t2 = t1;
                    state = STATE.INITIAL;
                    break;

                case STATE.ENTERING_EVALUATION:
                    self.emit('data', {
                        type: 'initial',
                        data: b.slice(h, t2).toString('utf-8')
                    });

                    h = t2 = t1;
                    state = STATE.EVALUATION;
                    break;

                case STATE.INITIAL:
                    self.emit('data', {
                        type: 'initial',
                        data: b.slice(h, t2).toString('utf-8')
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

    Mo.prototype = {
        compile: function (file, cb) {
            var readableStream = fs.createReadStream(file);

            readableStream.on('open', function () {
                var moParser = new MoParser(),
                    t = 0,
                    lines = [];

                lines.push('var buffer = new Buffer(total);');
                lines.push('var string;');
                lines.push('var stringLenght;');
                lines.push('var i = 0;');
                lines.push('');

                moParser.on('data', function (o) {
                    var a = [],
                        b = [],
                        i = 0,
                        l,
                        s;

                    switch (o.type) {

                    case 'initial':
                        if (o.data) {
                            s = o.data.toString();
                            l = s.length;
                            t += l;
                            lines.push('buffer.write(\'' + s + '\', i);');
                            lines.push('i += ' + l.toString() + ';');
                        }

                        break;

                    case 'evaluation':
                        if (o.data) {
                            a = o.data.split('.');
                            a.unshift('input');

                            for (i = 2, l = a.length; i <= l; i++) {
                                b.push(a.slice(0, i).join('.'));
                            }

                            lines.push('');
                            lines.push('if (' + b.join(' && ') + ') {');
                            lines.push('string = ' + b[b.length - 1] + '.toString();');
                            lines.push('stringLength = string.length;');
                            lines.push('if (stringLength > left) {');
                            lines.push('left = resize(buffer, stringLength - left);');
                            lines.push('} else {');
                            lines.push('left -= stringLength;');
                            lines.push('}');
                            lines.push('buffer.write(string, i);');
                            lines.push('i += stringLength;');
                            lines.push('}');
                            lines.push('');
                        }

                        break;
                    }
                });

                moParser.on('end', function () {
                    var i = 1,
                        x = t;

                    while (x >>= 1) {
                        i++;
                    }

                    x = 0x1 << i;

                    while (x - t < 1024) {
                        x <<= 1;
                    }

                    lines.unshift('var total = ' + x.toString() + ';'); // calculated;
                    lines.unshift('var left = ' + (x - t).toString() + ';'); // left;

                    lines.push('');
                    lines.push('output(buffer.slice(0, i));');

                    cb({
                        code: lines.join('\n')
                    });
                });

                readableStream.pipe(moParser);
            });
        }
    };

    (new Mo).compile('./template', function (o) {
        var script;

        function resize(buffer, size) {
            var b,
                r = buffer.length,
                s = r + size,
                i = 1,
                x = t;

            while (x >>= 1) {
                i++;
            }

            x = 0x1 << i;

            while (x - s < 1024) {
                x <<= 1;
            }

            b = new Buffer(x);
            buffer.copy(b, r);
        }

        console.log(o.code);

        script = require('vm').createScript(o.code)

        script.runInNewContext({
            Buffer: Buffer,

            console: console,

            input: {
                abc: 'Daniel',
                def: 'Vitor',
                ghi: 'Morilha'
            },

            output: function (b) {
                console.log(b.toString('utf-8'));
            },

            resize: resize
        });

    });
}());
