(function () {
  'use strict';

  const form          = document.getElementById('ds-form');
  const name1Input    = document.getElementById('signer1-name');
  const email1Input   = document.getElementById('signer1-email');
  const name2Input    = document.getElementById('signer2-name');
  const email2Input   = document.getElementById('signer2-email');
  const startBtn      = document.getElementById('start-btn');
  const restartBtn  = document.getElementById('restart-btn');
  const formError   = document.getElementById('form-error');

  const signingForm      = document.getElementById('signing-form');
  const signingLoading   = document.getElementById('signing-loading');
  const signingFrame     = document.getElementById('signing-frame-container');
  const dsFrame          = document.getElementById('ds-frame');
  const signingDone      = document.getElementById('signing-done');
  const doneTitle        = document.getElementById('done-title');
  const doneMessage      = document.getElementById('done-message');

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function reset() {
    form.reset();
    formError.textContent = '';
    dsFrame.src = '';
    show(signingForm);
    hide(signingLoading);
    hide(signingFrame);
    hide(signingDone);
  }

  // Listen for postMessage from signing-complete.html loaded inside the iframe
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'docusign-event') return;

    const dsEvent = event.data.event;
    hide(signingFrame);

    if (dsEvent === 'signing_complete') {
      doneTitle.textContent   = 'Document Signed Successfully';
      doneMessage.textContent = 'Thank you! Your signed agreement has been sent to your email address.';
    } else if (dsEvent === 'decline') {
      doneTitle.textContent   = 'Signing Declined';
      doneMessage.textContent = 'You declined to sign the document. You can restart the process any time.';
    } else if (dsEvent === 'cancel') {
      doneTitle.textContent   = 'Signing Cancelled';
      doneMessage.textContent = 'The signing session was cancelled. Click below to try again.';
    } else {
      doneTitle.textContent   = 'Session Ended';
      doneMessage.textContent = `The signing session ended (${dsEvent}). Click below to restart.`;
    }

    show(signingDone);
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    formError.textContent = '';

    const signer1Name  = name1Input.value.trim();
    const signer1Email = email1Input.value.trim();
    const signer2Name  = name2Input.value.trim();
    const signer2Email = email2Input.value.trim();

    if (!signer1Name || !signer1Email || !signer2Name || !signer2Email) {
      formError.textContent = 'Please fill in all four fields.';
      return;
    }
    if (!EMAIL_RE.test(signer1Email)) {
      formError.textContent = 'Please enter a valid email address for Signer 1.';
      return;
    }
    if (!EMAIL_RE.test(signer2Email)) {
      formError.textContent = 'Please enter a valid email address for Signer 2.';
      return;
    }

    startBtn.disabled = true;
    hide(signingForm);
    show(signingLoading);

    try {
      const response = await fetch('/api/create-signing-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer1Name, signer1Email, signer2Name, signer2Email }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'consent_required') {
          hide(signingLoading);
          show(signingForm);
          formError.innerHTML =
            'DocuSign consent is required. ' +
            `<a href="${data.consentUrl}" target="_blank" rel="noopener noreferrer">` +
            'Click here to grant consent</a>, then try again.';
          startBtn.disabled = false;
          return;
        }
        throw new Error(data.details || data.error || 'Unknown error');
      }

      hide(signingLoading);
      dsFrame.src = data.url;
      show(signingFrame);
    } catch (err) {
      hide(signingLoading);
      show(signingForm);
      formError.textContent = `Error: ${err.message}`;
      startBtn.disabled = false;
    }
  });

  restartBtn.addEventListener('click', reset);
})();
