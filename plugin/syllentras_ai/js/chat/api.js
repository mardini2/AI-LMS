// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

function fetchJson(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(API_URL + path, options).then(function (res) {
        return res.text().then(function (text) {
            var data = null;
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    data = null;
                }
            }
            if (!res.ok) {
                // Nest usually returns { message: "..." } — surface that, never secrets.
                var msg = null;
                if (data) {
                    if (typeof data.message === 'string') msg = data.message;
                    else if (Array.isArray(data.message)) msg = data.message.join(' ');
                }
                throw new Error(msg || ('Request failed (' + res.status + '). Please try again.'));
            }
            return data;
        });
    });
}

