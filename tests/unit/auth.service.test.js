const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const servicePath = path.resolve(__dirname, '../../src/services/auth.service.js');
const dbPath = path.resolve(__dirname, '../../src/config/db.js');
const passwordPath = path.resolve(__dirname, '../../src/utils/password.js');
const otpPath = path.resolve(__dirname, '../../src/utils/otp.js');
const mailerPath = path.resolve(__dirname, '../../src/utils/mailer.js');
const jwtPath = path.resolve(__dirname, '../../src/utils/jwt.js');

function loadAuthService({ queryImpl, comparePasswordImpl, hashPasswordImpl, sendOTPImpl, generateOTPImpl }) {
  delete require.cache[servicePath];
  delete require.cache[dbPath];
  delete require.cache[passwordPath];
  delete require.cache[otpPath];
  delete require.cache[mailerPath];
  delete require.cache[jwtPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: queryImpl || (async () => ({ rows: [] })),
      connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    },
  };

  require.cache[passwordPath] = {
    id: passwordPath,
    filename: passwordPath,
    loaded: true,
    exports: {
      hashPassword: hashPasswordImpl || (async (value) => `hashed-${value}`),
      comparePassword: comparePasswordImpl || (async () => true),
    },
  };

  require.cache[otpPath] = {
    id: otpPath,
    filename: otpPath,
    loaded: true,
    exports: {
      generateOTP: generateOTPImpl || (() => '123456'),
    },
  };

  require.cache[mailerPath] = {
    id: mailerPath,
    filename: mailerPath,
    loaded: true,
    exports: {
      sendOTPEmail: sendOTPImpl || (() => {}),
    },
  };

  require.cache[jwtPath] = {
    id: jwtPath,
    filename: jwtPath,
    loaded: true,
    exports: {
      generateAccessToken: () => 'access-token',
      generateRefreshToken: () => ({ token: 'refresh-token', expiresAt: new Date('2030-01-01T00:00:00Z') }),
      verifyRefreshToken: () => ({ id: 1 }),
      hashToken: (token) => `hashed-${token}`,
    },
  };

  return require(servicePath);
}

test('registerUser: báo lỗi nếu thiếu trường bắt buộc', async () => {
  const authService = loadAuthService({});
  await assert.rejects(
    () => authService.registerUser({ full_name: '', email: '', password: '', confirm_password: '' }),
    /Full name, email, password and confirm password are required/
  );
});

test('registerUser: báo lỗi nếu password và confirm_password không khớp', async () => {
  const authService = loadAuthService({});
  await assert.rejects(
    () => authService.registerUser({
      full_name: 'Naut',
      email: 'naut@example.com',
      password: '12345678',
      confirm_password: '12345679',
    }),
    /Password and confirm password do not match/
  );
});

test('registerUser: báo lỗi nếu email đã gắn với tài khoản social login', async () => {
  const authService = loadAuthService({
    queryImpl: async (sql) => {
      if (sql.includes('FROM users WHERE LOWER(email)')) {
        return { rows: [{ id: 10, password_hash: null, auth_provider: 'google' }] };
      }
      return { rows: [] };
    },
  });

  await assert.rejects(
    () => authService.registerUser({
      full_name: 'Naut',
      email: 'naut@example.com',
      password: '12345678',
      confirm_password: '12345678',
    }),
    /already linked to a social account/
  );
});

test('registerUser: tạo tài khoản thành công và gửi OTP', async () => {
  const sent = [];
  const authService = loadAuthService({
    sendOTPImpl: (email, otp) => sent.push({ email, otp }),
    queryImpl: async (sql) => {
      if (sql.includes('FROM users WHERE LOWER(email)')) return { rows: [] };
      if (sql.includes('SELECT id FROM users WHERE phone')) return { rows: [] };
      if (sql.includes('INSERT INTO users')) {
        return { rows: [{ id: 1, full_name: 'Naut', email: 'naut@example.com', phone: '0909', email_verified: false }] };
      }
      if (sql.includes('INSERT INTO user_otps')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });

  const result = await authService.registerUser({
    full_name: 'Naut',
    email: 'naut@example.com',
    phone: '0909',
    password: '12345678',
    confirm_password: '12345678',
  });

  assert.equal(result.user.email, 'naut@example.com');
  assert.equal(result.otp, '123456');
  assert.deepEqual(sent, [{ email: 'naut@example.com', otp: '123456' }]);
});

test('loginUser: báo lỗi nếu thiếu email hoặc password', async () => {
  const authService = loadAuthService({});
  await assert.rejects(() => authService.loginUser({ email: '', password: '' }), /Email and password are required/);
});

test('loginUser: báo lỗi nếu không tìm thấy user', async () => {
  const authService = loadAuthService({
    queryImpl: async () => ({ rows: [] }),
  });

  await assert.rejects(
    () => authService.loginUser({ email: 'naut@example.com', password: '12345678' }),
    /Invalid credentials/
  );
});

test('loginUser: khóa tài khoản sau 5 lần nhập sai', async () => {
  let updateCalled = false;
  const authService = loadAuthService({
    comparePasswordImpl: async () => false,
    queryImpl: async (sql) => {
      if (sql.includes('SELECT * FROM users WHERE LOWER(email)')) {
        return {
          rows: [{
            id: 1,
            email: 'naut@example.com',
            status: 'active',
            email_verified: true,
            locked_until: null,
            password_hash: 'hashed',
            failed_login_attempts: 4,
          }],
        };
      }
      if (sql.includes('SET failed_login_attempts = $1') && sql.includes('locked_until = NOW() + INTERVAL')) {
        updateCalled = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
  });

  await assert.rejects(
    () => authService.loginUser({ email: 'naut@example.com', password: 'wrong-password' }),
    /Account locked for 15 minutes/
  );
  assert.equal(updateCalled, true);
});

test('loginUser: đăng nhập thành công sẽ reset failed attempts', async () => {
  let resetCalled = false;
  const authService = loadAuthService({
    comparePasswordImpl: async () => true,
    queryImpl: async (sql) => {
      if (sql.includes('SELECT * FROM users WHERE LOWER(email)')) {
        return {
          rows: [{
            id: 1,
            email: 'naut@example.com',
            status: 'active',
            email_verified: true,
            locked_until: null,
            password_hash: 'hashed',
            failed_login_attempts: 2,
          }],
        };
      }
      if (sql.includes('SET failed_login_attempts = 0')) {
        resetCalled = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
  });

  const user = await authService.loginUser({ email: 'naut@example.com', password: '12345678' });
  assert.equal(user.email, 'naut@example.com');
  assert.equal(resetCalled, true);
});
