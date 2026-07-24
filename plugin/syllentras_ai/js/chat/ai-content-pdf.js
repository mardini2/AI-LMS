// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var pdfMakeLoadPromise = null;

function getSyllentrasJsBase() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src || '';
        var marker = '/local/syllentras_ai/js/';
        var idx = src.indexOf(marker);
        if (idx !== -1) {
            return src.slice(0, idx + marker.length);
        }
    }
    return '/local/syllentras_ai/js/';
}

function loadScriptNoAmd(src) {
    return new Promise(function (resolve, reject) {
        // Moodle exposes AMD define(); UMD builds then skip window globals.
        var defineBackup = window.define;
        var clearedAmd = !!(defineBackup && defineBackup.amd);
        if (clearedAmd) {
            window.define = undefined;
        }

        function restoreAmd() {
            if (clearedAmd) {
                window.define = defineBackup;
            }
        }

        var script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = function () {
            restoreAmd();
            resolve();
        };
        script.onerror = function () {
            restoreAmd();
            reject(new Error('Could not load ' + src));
        };
        document.head.appendChild(script);
    });
}

function ensurePdfMake() {
    if (window.pdfMake && typeof window.pdfMake.createPdf === 'function') {
        return Promise.resolve(window.pdfMake);
    }
    if (pdfMakeLoadPromise) {
        return pdfMakeLoadPromise;
    }
    var base = getSyllentrasJsBase();
    pdfMakeLoadPromise = loadScriptNoAmd(base + 'vendor/pdfmake.min.js')
        .then(function () {
            return loadScriptNoAmd(base + 'vendor/vfs_fonts.js');
        })
        .then(function () {
            if (!window.pdfMake || typeof window.pdfMake.createPdf !== 'function') {
                pdfMakeLoadPromise = null;
                throw new Error('pdfMake failed to load');
            }
            return window.pdfMake;
        })
        .catch(function (err) {
            pdfMakeLoadPromise = null;
            throw err;
        });
    return pdfMakeLoadPromise;
}

function kindPdfLabel(kind) {
    if (kind === 'flashcards') return 'Flashcards';
    if (kind === 'practice_quiz') return 'Practice Quiz';
    return 'Study Guide';
}

function stripKindPrefix(name) {
    return String(name || '')
        .replace(/^(Study Guide|Flashcards|Quiz|Practice Quiz)\s*:\s*/i, '')
        .trim() || 'Untitled';
}

function safePdfFileName(kind, name) {
    var base = kindPdfLabel(kind) + ' - ' + stripKindPrefix(name);
    return base
        .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) + '.pdf';
}

function formatPdfDate(d) {
    try {
        return d.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        return d.toISOString().slice(0, 10);
    }
}

function choiceLetter(index) {
    return String.fromCharCode(65 + index);
}

function sanitizePageHtmlForPdf(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html || '';
    Array.prototype.forEach.call(
        wrap.querySelectorAll(
            'script,style,button,input,textarea,select,.syll-fc-toolbar,.syll-fc-actions,' +
            '.syll-fc-results,.syll-fc-edit-board,.syll-fc-edit-controls,.syll-fc-study-controls'
        ),
        function (el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        }
    );
    Array.prototype.forEach.call(wrap.querySelectorAll('a[href]'), function (a) {
        var text = document.createTextNode(a.textContent || '');
        if (a.parentNode) a.parentNode.replaceChild(text, a);
    });
    return wrap;
}

function flattenInline(nodes, marks) {
    marks = marks || {};
    var out = [];
    Array.prototype.forEach.call(nodes || [], function (node) {
        if (node.nodeType === 3) {
            var t = node.nodeValue || '';
            if (!t) return;
            var chunk = { text: t };
            if (marks.bold) chunk.bold = true;
            if (marks.italics) chunk.italics = true;
            if (marks.mono) {
                chunk.font = 'Roboto';
                chunk.fontSize = 9;
            }
            out.push(chunk);
            return;
        }
        if (node.nodeType !== 1) return;
        var tag = (node.tagName || '').toLowerCase();
        if (tag === 'br') {
            out.push({ text: '\n' });
            return;
        }
        var next = {
            bold: marks.bold || tag === 'strong' || tag === 'b',
            italics: marks.italics || tag === 'em' || tag === 'i',
            mono: marks.mono || tag === 'code' || tag === 'pre'
        };
        out = out.concat(flattenInline(node.childNodes, next));
    });
    return out;
}

function inlineFromElement(el) {
    var parts = flattenInline(el.childNodes, {});
    if (!parts.length) {
        var plain = (el.textContent || '').trim();
        return plain || '';
    }
    if (parts.length === 1 && typeof parts[0].text === 'string' && !parts[0].bold && !parts[0].italics) {
        return parts[0].text;
    }
    return parts;
}

function htmlBlockToPdfContent(root) {
    var content = [];

    function pushParagraph(el, style) {
        var inline = inlineFromElement(el);
        if (!inline || (typeof inline === 'string' && !inline.trim())) return;
        var item = { text: inline, margin: [0, 0, 0, 8] };
        if (style) item.style = style;
        content.push(item);
    }

    function walk(node) {
        if (!node || node.nodeType !== 1) return;
        var tag = (node.tagName || '').toLowerCase();

        if (tag === 'h1') {
            pushParagraph(node, 'h1');
            return;
        }
        if (tag === 'h2') {
            pushParagraph(node, 'h2');
            return;
        }
        if (tag === 'h3' || tag === 'h4') {
            pushParagraph(node, 'h3');
            return;
        }
        if (tag === 'p') {
            pushParagraph(node, null);
            return;
        }
        if (tag === 'pre') {
            content.push({
                text: (node.textContent || '').replace(/\n$/, ''),
                fontSize: 9,
                margin: [0, 0, 0, 8],
                preserveLeadingSpaces: true
            });
            return;
        }
        if (tag === 'ul' || tag === 'ol') {
            var items = [];
            Array.prototype.forEach.call(node.children || [], function (li) {
                if ((li.tagName || '').toLowerCase() !== 'li') return;
                items.push(inlineFromElement(li) || (li.textContent || '').trim());
            });
            if (items.length) {
                var listBlock = { margin: [0, 0, 0, 8] };
                if (tag === 'ol') {
                    listBlock.ol = items;
                } else {
                    listBlock.ul = items;
                }
                content.push(listBlock);
            }
            return;
        }
        if (tag === 'div' || tag === 'section' || tag === 'article') {
            Array.prototype.forEach.call(node.childNodes || [], function (child) {
                if (child.nodeType === 1) walk(child);
                else if (child.nodeType === 3 && (child.nodeValue || '').trim()) {
                    content.push({ text: child.nodeValue.trim(), margin: [0, 0, 0, 8] });
                }
            });
            return;
        }
        // Fallback: treat as a paragraph.
        if ((node.textContent || '').trim()) {
            pushParagraph(node, null);
        }
    }

    Array.prototype.forEach.call(root.childNodes || [], function (child) {
        if (child.nodeType === 1) walk(child);
        else if (child.nodeType === 3 && (child.nodeValue || '').trim()) {
            content.push({ text: child.nodeValue.trim(), margin: [0, 0, 0, 8] });
        }
    });

    return content;
}

function buildPdfHeaderContent(kind, title, courseName) {
    return [
        {
            text: 'Syllentras AI · ' + kindPdfLabel(kind),
            style: 'eyebrow',
            margin: [0, 0, 0, 4]
        },
        {
            text: stripKindPrefix(title),
            style: 'title',
            margin: [0, 0, 0, 6]
        },
        {
            text: (courseName || 'Course') + ' · ' + formatPdfDate(new Date()),
            style: 'meta',
            margin: [0, 0, 0, 12]
        },
        {
            canvas: [
                {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 515,
                    y2: 0,
                    lineWidth: 1.5,
                    lineColor: '#1a2332'
                }
            ],
            margin: [0, 0, 0, 16]
        }
    ];
}

function buildPdfFooterContent() {
    return [
        {
            canvas: [
                {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 515,
                    y2: 0,
                    lineWidth: 0.5,
                    lineColor: '#ccd5dd'
                }
            ],
            margin: [0, 16, 0, 8]
        },
        {
            text: 'Private practice aid created by Syllentras AI. This is not graded.',
            style: 'footer'
        }
    ];
}

function buildStudyGuideContent(contentHtml) {
    var wrap = sanitizePageHtmlForPdf(contentHtml);
    var root = wrap.querySelector('.syll-sg') || wrap;
    var blocks = htmlBlockToPdfContent(root);
    if (!blocks.length) {
        return [{ text: 'No study guide content found.', italics: true }];
    }
    return blocks;
}

function buildFlashcardsContent(contentHtml) {
    var wrap = sanitizePageHtmlForPdf(contentHtml);
    var cards = wrap.querySelectorAll('.syll-fc-card');
    if (!cards.length) {
        return [{ text: 'No flashcards found in this item.', italics: true }];
    }
    var content = [];
    var total = cards.length;
    Array.prototype.forEach.call(cards, function (card, index) {
        var promptEl = card.querySelector('.syll-fc-prompt');
        var answerEl = card.querySelector('.syll-fc-answer');
        var front = promptEl ? (promptEl.textContent || '').trim() : '';
        var backInline = answerEl ? inlineFromElement(answerEl) : '';
        if (!backInline) {
            backInline = answerEl ? (answerEl.textContent || '').trim() : '';
        }
        content.push({
            table: {
                widths: ['*'],
                body: [[
                    {
                        stack: [
                            {
                                text: 'Card ' + (index + 1) + ' / ' + total,
                                style: 'cardLabel',
                                margin: [0, 0, 0, 8]
                            },
                            { text: 'FRONT', style: 'fieldLabel', margin: [0, 0, 0, 2] },
                            { text: front || '—', margin: [0, 0, 0, 10] },
                            {
                                canvas: [{
                                    type: 'line',
                                    x1: 0,
                                    y1: 0,
                                    x2: 475,
                                    y2: 0,
                                    lineWidth: 0.5,
                                    lineColor: '#d5dee8'
                                }],
                                margin: [0, 0, 0, 10]
                            },
                            { text: 'BACK', style: 'fieldLabel', margin: [0, 0, 0, 2] },
                            { text: backInline || '—', margin: [0, 0, 0, 0] }
                        ],
                        margin: [12, 12, 12, 12],
                        fillColor: '#f7f9fb'
                    }
                ]]
            },
            layout: {
                hLineWidth: function () { return 1; },
                vLineWidth: function () { return 1; },
                hLineColor: function () { return '#99a8b8'; },
                vLineColor: function () { return '#99a8b8'; },
                paddingLeft: function () { return 0; },
                paddingRight: function () { return 0; },
                paddingTop: function () { return 0; },
                paddingBottom: function () { return 0; }
            },
            margin: [0, 0, 0, 12],
            unbreakable: true
        });
    });
    return content;
}

function buildQuizContent(questions) {
    var list = Array.isArray(questions) ? questions : [];
    if (!list.length) {
        return [{ text: 'No exportable questions found in this quiz.', italics: true }];
    }
    var content = [{ text: 'Questions', style: 'sectionHeading', margin: [0, 0, 0, 10] }];

    list.forEach(function (q) {
        var answers = Array.isArray(q.answers) ? q.answers : [];
        var stack = [
            {
                text: String(q.number || '') + '. ' + (q.questiontext || ''),
                bold: true,
                margin: [0, 0, 0, 4]
            }
        ];
        answers.forEach(function (a, i) {
            stack.push({
                text: choiceLetter(i) + '.  ' + (a.text || ''),
                margin: [14, 1, 0, 1]
            });
        });
        content.push({ stack: stack, margin: [0, 0, 0, 12], unbreakable: true });
    });

    content.push({ text: '', pageBreak: 'before' });
    content.push({ text: 'Answer Key', style: 'sectionHeading', margin: [0, 0, 0, 10] });

    list.forEach(function (q) {
        var answers = Array.isArray(q.answers) ? q.answers : [];
        var correct = [];
        answers.forEach(function (a, i) {
            if (Number(a.fraction) > 0) {
                correct.push(choiceLetter(i) + '. ' + (a.text || ''));
            }
        });
        content.push({
            text: [
                { text: String(q.number || '') + '. ', bold: true },
                correct.length ? correct.join('; ') : '(no marked answer)'
            ],
            margin: [0, 0, 0, 6]
        });
    });

    return content;
}

function buildPdfDocDefinition(exportData) {
    var kind = exportData.kind || 'study_guide';
    var body;
    if (kind === 'flashcards') {
        body = buildFlashcardsContent(exportData.contentHtml || '');
    } else if (kind === 'practice_quiz') {
        body = buildQuizContent(exportData.questions || []);
    } else {
        body = buildStudyGuideContent(exportData.contentHtml || '');
    }

    return {
        pageSize: 'LETTER',
        pageMargins: [40, 48, 40, 48],
        defaultStyle: {
            font: 'Roboto',
            fontSize: 11,
            color: '#1a2332',
            lineHeight: 1.35
        },
        styles: {
            eyebrow: {
                fontSize: 9,
                color: '#5a6a7a',
                characterSpacing: 0.6,
                bold: true
            },
            title: {
                fontSize: 18,
                bold: true,
                lineHeight: 1.25
            },
            meta: {
                fontSize: 9,
                color: '#5a6a7a'
            },
            h1: {
                fontSize: 16,
                bold: true,
                margin: [0, 8, 0, 6]
            },
            h2: {
                fontSize: 14,
                bold: true,
                margin: [0, 8, 0, 6]
            },
            h3: {
                fontSize: 12,
                bold: true,
                margin: [0, 6, 0, 4]
            },
            sectionHeading: {
                fontSize: 13,
                bold: true
            },
            cardLabel: {
                fontSize: 9,
                color: '#5a6a7a',
                bold: true
            },
            fieldLabel: {
                fontSize: 8,
                color: '#5a6a7a',
                bold: true,
                characterSpacing: 0.5
            },
            footer: {
                fontSize: 9,
                color: '#667788',
                italics: true
            }
        },
        content: []
            .concat(
                buildPdfHeaderContent(
                    kind,
                    exportData.name || '',
                    exportData.courseName || courseName || ''
                )
            )
            .concat(body)
            .concat(buildPdfFooterContent())
    };
}

function downloadAiContentPdf(exportData) {
    return ensurePdfMake().then(function (pdfMake) {
        var doc = buildPdfDocDefinition(exportData);
        var filename = safePdfFileName(exportData.kind, exportData.name);
        return new Promise(function (resolve, reject) {
            try {
                pdfMake.createPdf(doc).download(filename, function () {
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    });
}

function exportAiContentItemToPdf(item) {
    if (!item || !item.cmId) {
        return Promise.reject(new Error('Missing content item'));
    }
    var path =
        '/ai-content/export?courseId=' + encodeURIComponent(courseId) +
        '&moodleUserId=' + encodeURIComponent(moodleUserId) +
        '&cmId=' + encodeURIComponent(item.cmId);

    return fetchJson(path).then(function (data) {
        return downloadAiContentPdf(data);
    });
}
