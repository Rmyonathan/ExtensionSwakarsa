window.sendWhatsAppMessage = async function sendWhatsAppMessage(number, message, attachment) {
    console.log(`Processing chat for ${number}`);
    if (!number) return false;
    if (!number.startsWith('+')) number = '+' + number;

    // Utility: waitFor predicate with timeout
    function waitFor(predicate, timeout = 60000, interval = 500) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function poll() {
                try {
                    const res = predicate();
                    if (res) return resolve(res);
                } catch (e) {
                    console.warn('Error in waitFor predicate:', e);
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

    // Wait until chat DOM is present (message box or attachment icon)
    try {
        await waitFor(() => {
            const mb = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                       document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                       document.querySelector('div[contenteditable="true"][title="Type a message"]');
            const span = document.querySelector('span[data-icon="plus-rounded"]') ||
                         document.querySelector('span[data-icon="clip"]') ||
                         document.querySelector('div[title="Attach"]');
            return mb || span;
        }, 80000, 500);
        console.log('Chat DOM ready.');
    } catch (err) {
        console.error('Timeout waiting for chat DOM:', err);
        return false;
    }

    // Handle text message if provided
    if (message) {
        console.log('Sending text message...');
        const messageBox = document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                          document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                          document.querySelector('div[contenteditable="true"][title="Type a message"]');

        if (messageBox) {
            try {
                messageBox.focus();
                messageBox.innerHTML = '';
                const txtNode = document.createTextNode(message);
                messageBox.appendChild(txtNode);
                messageBox.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
                const inputEvent = new InputEvent('input', {
                    bubbles: true, cancelable: true, composed: true, data: message, inputType: 'insertText'
                });
                messageBox.dispatchEvent(inputEvent);
                messageBox.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
                await new Promise(r => setTimeout(r, 500));

                let sendSpan = document.querySelector('span[data-icon="wds-ic-send-filled"]') ||
                              document.querySelector('span[data-icon="send"]');
                if (!sendSpan) {
                    try {
                        sendSpan = await waitFor(() => document.querySelector('span[data-icon="wds-ic-send-filled"]') || document.querySelector('span[data-icon="send"]'), 10000, 200);
                    } catch (e) {
                        sendSpan = null;
                    }
                }

                if (sendSpan) {
                    const button = sendSpan.closest('button') || sendSpan.closest('div[role="button"]');
                    if (button) {
                        if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
                            console.warn('Send button appears disabled; dispatching input to update state.');
                            messageBox.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true }));
                            await new Promise(r => setTimeout(r, 300));
                        }
                        const clicked = realClick(button);
                        await new Promise(r => setTimeout(r, 800));
                        const stillHasText = messageBox && messageBox.textContent && messageBox.textContent.trim().length > 0;
                        if (clicked && !stillHasText) {
                            console.log('✅ Text message sent.');
                        } else {
                            console.log('Fallback: dispatching Enter key to message box.');
                            const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', which: 13, keyCode: 13 });
                            messageBox.dispatchEvent(enter);
                            await new Promise(r => setTimeout(r, 800));
                            const stillHas = messageBox.textContent && messageBox.textContent.trim().length > 0;
                            if (!stillHas) {
                                console.log('✅ Enter fallback succeeded for text.');
                            } else {
                                console.warn('Text message send probably failed.');
                                return false;
                            }
                        }
                    } else {
                        console.warn('Found send span but no parent button; clicking span directly.');
                        const clickedSpan = realClick(sendSpan);
                        await new Promise(r => setTimeout(r, 800));
                        if (clickedSpan && !messageBox.textContent.trim()) return true;
                        if (messageBox) {
                            messageBox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
                            await new Promise(r => setTimeout(r, 800));
                            return !messageBox.textContent.trim();
                        }
                        return false;
                    }
                } else {
                    console.warn('Send icon span not found for text. Trying Enter fallback.');
                    if (messageBox) {
                        messageBox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
                        await new Promise(r => setTimeout(r, 800));
                        return !messageBox.textContent.trim();
                    }
                    console.error('No send UI and no message box for text — cannot send message.');
                    return false;
                }
            } catch (err) {
                console.warn('Error injecting text message:', err);
                return false;
            }
        } else {
            console.warn('No message box found for text — relying on URL prefill (if any).');
        }
    }

    // Handle image attachment if provided
    if (attachment) {
        console.log('Sending image attachment...');
        try {
            // Find attachment icon (try multiple selectors)
            let attachSpan = document.querySelector('span[data-icon="plus-rounded"]') ||
                             document.querySelector('span[data-icon="clip"]') ||
                             document.querySelector('div[title="Attach"]');
            if (!attachSpan) {
                try {
                    attachSpan = await waitFor(() => 
                        document.querySelector('span[data-icon="plus-rounded"]') ||
                        document.querySelector('span[data-icon="clip"]') ||
                        document.querySelector('div[title="Attach"]'), 15000, 300);
                } catch (e) {
                    console.error('Attachment icon not found (tried plus-rounded, clip, Attach):', e);
                    return false;
                }
            }

            const attachButton = attachSpan.closest('div[role="button"]') || attachSpan.closest('button') || attachSpan;
            if (!attachButton) {
                console.error('Attachment button not found for attachment icon.');
                return false;
            }

            console.log('Clicking attachment button.');
            if (!realClick(attachButton)) {
                console.error('Failed to click attachment button.');
                return false;
            }
            await new Promise(r => setTimeout(r, 1500));

            // Find "Photos & videos" option in the second div with class x13fj5qh x1xegmmw
            const photoOption = await waitFor(() => {
                const divs = document.querySelectorAll('div.x13fj5qh.x1xegmmw');
                if (divs.length >= 2) {
                    const secondDiv = divs[1];
                    const spans = secondDiv.querySelectorAll('span');
                    for (let span of spans) {
                        if (span.textContent.includes('Photos & videos')) {
                            return span.closest('div[role="menuitem"]') || span.closest('li[role="menuitem"]') || span.closest('button') || span;
                        }
                    }
                }
                return null;
            }, 6000, 300);

            if (!photoOption) {
                console.error('Photos & videos option not found in second div.x13fj5qh.x1xegmmw.');
                return false;
            }

            console.log('Clicking Photos & videos option.');
            if (!realClick(photoOption)) {
                console.error('Failed to click Photos & videos option.');
                return false;
            }
            await new Promise(r => setTimeout(r, 1500));

            // Find file input
            const fileInput = await waitFor(() => document.querySelector('input[type="file"][accept*="image"]'), 6000, 300);
            if (!fileInput) {
                console.error('File input not found.');
                return false;
            }

            console.log('Preparing file for upload.');
            const response = await fetch(attachment);
            const blob = await response.blob();
            const file = new File([blob], 'image.jpg', { type: blob.type });

            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;

            console.log('Dispatching file input change event.');
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);

            // Wait for WhatsApp's image preview to load
            await new Promise(r => setTimeout(r, 4000));

            // Find and click send button for attachment
            let sendSpan = document.querySelector('span[data-icon="wds-ic-send-filled"]');
            if (!sendSpan) {
                try {
                    sendSpan = await waitFor(() => document.querySelector('span[data-icon="wds-ic-send-filled"]'), 12000, 300);
                } catch (e) {
                    console.error('Send button (wds-ic-send-filled) not found:', e);
                    return false;
                }
            }

            const sendButton = sendSpan.closest('button') || sendSpan.closest('div[role="button"]') || sendSpan;
            if (sendButton) {
                console.log('Clicking send button for attachment.');
                if (!realClick(sendButton)) {
                    console.error('Failed to click send button.');
                    return false;
                }
                await new Promise(r => setTimeout(r, 2500));
                console.log('✅ Image attachment sent.');
            } else {
                console.error('Send button for attachment not found.');
                return false;
            }
        } catch (err) {
            console.error('Error sending attachment:', err);
            return false;
        }
    }

    return true;
};