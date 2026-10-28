(function () {
  var EMAIL = 'adeeb.muhammad001@gmail.com';

  var btn = document.getElementById('copy-email');
  var status = document.getElementById('copy-status');
  var link = document.getElementById('email-link');
  if (btn && link) {
    btn.addEventListener('click', function () {
      var email = link.textContent.trim();
      try {
        navigator.clipboard.writeText(email).then(function () {
          status.textContent = 'Copied';
        }, function () { status.textContent = 'Copy failed. Select the email instead.'; });
      } catch (e) {
        status.textContent = 'Copy failed. Select the email instead.';
      }
    });
  }

  // The site is static (no server), so the form opens the visitor's email app
  // with their message pre-filled instead of posting to a backend.
  var form = document.getElementById('contact-form');
  var formStatus = document.getElementById('form-status');
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(form);
      if (data.get('_gotcha')) return;
      var name = String(data.get('name') || '').trim();
      var from = String(data.get('email') || '').trim();
      var message = String(data.get('message') || '').trim();
      var subject = 'Message from ' + name + ' via adeebmuh.me';
      var body = message + '\n\n' + name + '\n' + from;
      window.location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      if (formStatus) formStatus.textContent = 'Opening your email app. If nothing opens, write to ' + EMAIL + '.';
    });
  }
})();
