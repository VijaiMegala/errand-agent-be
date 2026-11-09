const user = {
  type: 'object',
  required: ['id', 'role', 'fullName', 'email', 'phone', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    role: { type: 'string', enum: ['customer', 'service_provider'] },
    fullName: { type: 'string' },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const userResponse = {
  type: 'object',
  required: ['data'],
  properties: { data: { $ref: '#/components/schemas/User' } },
};

const tokenResponse = {
  type: 'object',
  required: ['accessToken', 'tokenType', 'expiresIn'],
  properties: {
    accessToken: { type: 'string', description: 'Signed access token' },
    tokenType: { type: 'string', enum: ['Bearer'] },
    expiresIn: { type: 'integer', example: 900, description: 'Lifetime in seconds' },
  },
};

const errorResponse = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
};

const error = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const userId = {
  name: 'id', in: 'path', required: true, description: 'User UUID',
  schema: { type: 'string', format: 'uuid' },
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Home Service User API',
    version: '1.0.0',
    description: 'Customer and service provider accounts with password login and short-lived bearer access tokens.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Users', description: 'Customer and service provider accounts' },
    { name: 'Auth', description: 'Password login and access tokens' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      User: user,
      UserResponse: userResponse,
      TokenResponse: tokenResponse,
      Error: errorResponse,
      CreateUser: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'fullName', 'email', 'password'],
        properties: {
          role: { type: 'string', enum: ['customer', 'service_provider'] },
          fullName: { type: 'string', minLength: 2, maxLength: 120 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          phone: { type: 'string', nullable: true, pattern: '^\\+?[0-9]{7,15}$' },
          password: { type: 'string', format: 'password', minLength: 8, maxLength: 16, writeOnly: true },
        },
      },
      UpdateUser: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          fullName: { type: 'string', minLength: 2, maxLength: 120 },
          email: { type: 'string', format: 'email', maxLength: 254 },
          phone: { type: 'string', nullable: true, pattern: '^\\+?[0-9]{7,15}$' },
        },
      },
      Login: {
        type: 'object', additionalProperties: false, required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password', writeOnly: true },
        },
      },
      ChangePassword: {
        type: 'object', additionalProperties: false, required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', format: 'password', writeOnly: true },
          newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 16, writeOnly: true },
        },
      },
    },
  },
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Log in and receive an access token',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Login' } } } },
        responses: {
          200: { description: 'Access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenResponse' } } } },
          400: error('Invalid request'), 401: error('Invalid credentials'), 500: error('Server error'),
        },
      },
    },
    '/api/users': {
      post: {
        tags: ['Users'], summary: 'Register a customer or service provider',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } } } },
        responses: {
          201: { description: 'Created', headers: { Location: { schema: { type: 'string' } } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } } },
          400: error('Invalid request'), 409: error('Email already registered'), 500: error('Server error'),
        },
      },
    },
    '/api/users/{id}': {
      parameters: [userId],
      get: {
        tags: ['Users'], summary: 'Fetch your user details', security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'User details', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } } },
          400: error('Invalid UUID'), 401: error('Access token required or invalid'),
          403: error('Not your account'), 404: error('User not found'), 500: error('Server error'),
        },
      },
      patch: {
        tags: ['Users'], summary: 'Update your user details', security: [{ bearerAuth: [] }],
        description: 'The account role cannot be changed.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUser' } } } },
        responses: {
          200: { description: 'Updated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } } },
          400: error('Invalid request'), 401: error('Access token required or invalid'),
          403: error('Not your account'), 404: error('User not found'),
          409: error('Email already registered'), 500: error('Server error'),
        },
      },
      delete: {
        tags: ['Users'], summary: 'Delete your account', security: [{ bearerAuth: [] }],
        description: 'Permanently removes the user record.',
        responses: {
          204: { description: 'Deleted' }, 400: error('Invalid UUID'),
          401: error('Access token required or invalid'), 403: error('Not your account'),
          404: error('User not found'), 500: error('Server error'),
        },
      },
    },
    '/api/users/{id}/password': {
      parameters: [userId],
      patch: {
        tags: ['Auth'], summary: 'Change your password', security: [{ bearerAuth: [] }],
        description: 'Returns a new access token. Previously issued tokens become invalid.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangePassword' } } } },
        responses: {
          200: { description: 'New access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenResponse' } } } },
          400: error('Invalid request'), 401: error('Invalid token or current password'),
          403: error('Not your account'), 404: error('User not found'),
          409: error('Password changed concurrently'), 500: error('Server error'),
        },
      },
    },
  },
};
