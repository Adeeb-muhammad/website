(function () {
  var EMAIL = 'adeeb.muhammad001@gmail.com';
  var FORM_ENDPOINT = 'https://formspree.io/f/mljjnypq';

  var btn = document.getElementById('copy-email');
  var status = document.getElementById('copy-status');
  var link = document.getElementById('email-link');

  if (btn && link && status) {
    btn.addEventListener('click', function () {
      var email = link.textContent.trim();
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        status.textContent = 'Copy unavailable. Select the email instead.';
        return;
      }
      navigator.clipboard.writeText(email).then(function () {
        status.textContent = 'Copied';
      }).catch(function () {
        status.textContent = 'Copy failed. Select the email instead.';
      });
    });
  }

  var form = document.getElementById('contact-form');
  var formStatus = document.getElementById('form-status');

  if (form && formStatus) {
    form.action = FORM_ENDPOINT;
    form.method = 'POST';

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var data = new FormData(form);
      if (String(data.get('_gotcha') || '').trim()) return;

      var submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      formStatus.textContent = 'Sending message…';

      fetch(FORM_ENDPOINT, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' }
      }).then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (result) {
            var message = result.errors && result.errors.length
              ? result.errors.map(function (error) { return error.message; }).join(' ')
              : 'The message could not be sent. Please email ' + EMAIL + ' directly.';
            throw new Error(message);
          });
        }
        formStatus.textContent = 'Message sent. Thanks for reaching out!';
        form.reset();
      }).catch(function (error) {
        formStatus.textContent = error && error.message
          ? error.message
          : 'Could not send the message. Please email ' + EMAIL + ' directly.';
      }).then(function () {
        if (submitButton) submitButton.disabled = false;
      });
    });
  }
})();
