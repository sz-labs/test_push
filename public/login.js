const form = document.querySelector('#loginForm');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const loginButton = document.querySelector('#loginButton');
const loginError = document.querySelector('#loginError');
const togglePassword = document.querySelector('#togglePassword');

togglePassword.addEventListener('click', () => {
  const showPassword = passwordInput.type === 'password';
  passwordInput.type = showPassword ? 'text' : 'password';
  togglePassword.title = showPassword ? '隐藏密码' : '显示密码';
  togglePassword.querySelector('img').src = showPassword ? '/icons/eye-off.svg' : '/icons/eye.svg';
  togglePassword.querySelector('img').alt = togglePassword.title;
  passwordInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;
  loginButton.querySelector('span').textContent = '正在登录';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(payload.message || '登录失败，请重试。');
    window.location.replace('/');
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
    passwordInput.select();
  } finally {
    loginButton.disabled = false;
    loginButton.querySelector('span').textContent = '登录';
  }
});
