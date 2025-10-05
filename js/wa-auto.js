// Replace your current sendWhatsAppMessage with this async implementation.
// It returns true on success, false on failure (useful with scripting.executeScript results).

window.sendWhatsAppMessage = async function sendWhatsAppMessage(number, message) {
    console.log(`Processing chat for ${number}`);
    if (!number) return false;
    if (!number.startsWith('+')) number = '+' + number;

    // Utility: waitFor predicate with timeout
    function waitFor(predicate, timeout = 45000, interval = 300) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function poll() {
                try {
                    const res = predicate();
                    if (res) return resolve(res);
                } catch (e) {
                    // ignore transient errors while DOM updates
                }
                if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(poll, interval);
            })();
        });
    }

    // Realistic click helper
    function realClick(el) {
        if (!el) return false;
        try {
            const ev = new MouseEvent('click', {
                view: window, bubbles: true, cancelable: true, composed: true
            });
            el.dispatchEvent(ev);
            return true;
        } catch (e) {
            try { el.click(); return true; } catch (e2) { return false; }
        }
    }

    // Wait until chat DOM is present (message box or send icon)
    try {
        await waitFor(() => {
            // Prefer current/likely selectors (update if your inspected DOM differs)
            const mb = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                       document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                       document.querySelector('div[contenteditable="true"][title="Type a message"]');
            const span = document.querySelector('span[data-icon="wds-ic-send-filled"]') ||
                         document.querySelector('span[data-icon="send"]');
            return mb || span;
        }, 60000, 400); // wait up to 60s for slow loads
    } catch (err) {
        console.error('Timeout waiting for chat DOM:', err);
        return false;
    }

    // Grab message box if present
    const messageBox = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                       document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                       document.querySelector('div[contenteditable="true"][title="Type a message"]');

    // If messageBox exists, inject text in a React-friendly way
    if (messageBox) {
        try {
            messageBox.focus();

            // Clear existing content
            // Some WhatsApp versions prefer innerHTML replacement
            messageBox.innerHTML = '';
            // Insert text node to avoid weird markup
            const txtNode = document.createTextNode(message);
            messageBox.appendChild(txtNode);

            // Dispatch composition events (helps React) and InputEvent
            messageBox.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            const inputEvent = new InputEvent('input', {
                bubbles: true, cancelable: true, composed: true, data: message, inputType: 'insertText'
            });
            messageBox.dispatchEvent(inputEvent);
            messageBox.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

            // Give React a moment to sync internal state
            await new Promise(r => setTimeout(r, 400));
        } catch (err) {
            console.warn('Error injecting message into messageBox:', err);
        }
    } else {
        console.warn('No message box found — relying on URL prefill (if any).');
    }

    // Find the send icon span and then its parent button
    let span = document.querySelector('span[data-icon="wds-ic-send-filled"]') ||
               document.querySelector('span[data-icon="send"]');

    // Wait a short bit if not found yet
    if (!span) {
        try {
            span = await waitFor(() => document.querySelector('span[data-icon="wds-ic-send-filled"]') || document.querySelector('span[data-icon="send"]'), 8000, 200);
        } catch (e) {
            span = null;
        }
    }

    if (span) {
        const button = span.closest('button');
        if (button) {
            // If button has disabled attribute or aria-disabled, try to enable by dispatching input
            if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
                console.warn('Send button appears disabled; dispatching input to update state.');
                if (messageBox) {
                    messageBox.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true }));
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            // Try actual click
            const clicked = realClick(button);
            await new Promise(r => setTimeout(r, 700)); // wait for send to process

            // Verify send: a simple, generic heuristic is to check that the messageBox text cleared or last message in chat equals our text.
            // Try to detect if messageBox cleared (simple)
            const stillHasText = messageBox && messageBox.textContent && messageBox.textContent.trim().length > 0;

            if (clicked && !stillHasText) {
                console.log('✅ Clicked send button and message box cleared — likely sent.');
                return true;
            } else {
                // Fallback: dispatch Enter to messageBox
                if (messageBox) {
                    console.log('Fallback: dispatching Enter key to message box.');
                    const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', which: 13, keyCode: 13 });
                    messageBox.dispatchEvent(enter);
                    await new Promise(r => setTimeout(r, 800));
                    // Re-check
                    const stillHas = messageBox.textContent && messageBox.textContent.trim().length > 0;
                    if (!stillHas) {
                        console.log('✅ Enter fallback likely succeeded.');
                        return true;
                    } else {
                        console.warn('After fallbacks, message box still contains text — send probably failed.');
                        return false;
                    }
                } else {
                    console.warn('No messageBox to fallback to; assuming click did the job.');
                    return clicked;
                }
            }
        } else {
            // Found span but no button — click span itself then fallback to Enter
            console.warn('Found send span but no parent button; clicking span directly.');
            const clickedSpan = realClick(span);
            await new Promise(r => setTimeout(r, 700));
            if (clickedSpan) return true;
            if (messageBox) {
                messageBox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
                await new Promise(r => setTimeout(r, 700));
                return !(messageBox.textContent && messageBox.textContent.trim().length);
            }
            return false;
        }
    } else {
        // No send span found — try Enter fallback or fail
        console.warn('Send icon span not found. Trying Enter fallback if possible.');
        if (messageBox) {
            messageBox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
            await new Promise(r => setTimeout(r, 700));
            return !(messageBox.textContent && messageBox.textContent.trim().length);
        }
        console.error('No send UI and no message box — cannot send message.');
        return false;
    }
};
