const user = {
  type: 'object',
  required: ['id', 'role', 'fullName', 'email', 'phone', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    role: { type: 'string', enum: ['customer', 'service_provider', 'admin'] },
    fullName: { type: 'string' },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string', nullable: true },
    providerDetails: {
      allOf: [{ $ref: '#/components/schemas/ProviderDetails' }], nullable: true,
      description: 'Present for service_provider users. Null until a legacy provider completes a listing.',
    },
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

const providerId = {
  name: 'providerId', in: 'path', required: true, description: 'Provider listing UUID',
  schema: { type: 'string', format: 'uuid' },
};

const data = (schema) => ({
  type: 'object', required: ['data'], properties: { data: { $ref: `#/components/schemas/${schema}` } },
});

const dataList = (schema) => ({
  type: 'object', required: ['data'], properties: {
    data: { type: 'array', items: { $ref: `#/components/schemas/${schema}` } },
  },
});

const json = (schema) => ({ 'application/json': { schema } });

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
    { name: 'Providers', description: 'Service offerings, available slots, and customer reviews' },
    { name: 'Bookings', description: 'Customer reservations within provider availability' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      User: user,
      UserResponse: userResponse,
      TokenResponse: tokenResponse,
      Error: errorResponse,
      ProviderDetails: {
        type: 'object',
        required: ['id', 'userId', 'serviceType', 'serviceArea', 'basePrice', 'attributes', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          serviceType: { type: 'string' },
          serviceArea: { type: 'string' },
          basePrice: { type: 'integer', minimum: 0, description: 'Base price in rupees' },
          attributes: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProviderInput: {
        type: 'object', additionalProperties: false,
        required: ['serviceType', 'serviceArea', 'basePrice'],
        properties: {
          serviceType: { type: 'string', minLength: 2, maxLength: 100 },
          serviceArea: { type: 'string', minLength: 2, maxLength: 120 },
          basePrice: { type: 'integer', minimum: 0, maximum: 2147483647 },
          attributes: { type: 'object', additionalProperties: true },
        },
      },
      ProviderUpdate: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          serviceType: { type: 'string', minLength: 2, maxLength: 100 },
          serviceArea: { type: 'string', minLength: 2, maxLength: 120 },
          basePrice: { type: 'integer', minimum: 0, maximum: 2147483647 },
          attributes: { type: 'object', additionalProperties: true },
        },
      },
      ServiceOffering: {
        type: 'object',
        required: ['id', 'providerId', 'name', 'description', 'price', 'durationMinutes', 'active', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          providerId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'integer', minimum: 0, description: 'Price in rupees' },
          durationMinutes: { type: 'integer' },
          active: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateServiceOffering: {
        type: 'object', additionalProperties: false,
        required: ['name', 'price', 'durationMinutes'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          description: { type: 'string', maxLength: 2000 },
          price: { type: 'integer', minimum: 0, maximum: 2147483647 },
          durationMinutes: { type: 'integer', minimum: 15, maximum: 1440 },
        },
      },
      ProviderSlot: {
        type: 'object', required: ['id', 'providerId', 'startsAt', 'endsAt', 'status', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          providerId: { type: 'string', format: 'uuid' },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['available', 'held', 'booked', 'unavailable'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateProviderSlot: {
        type: 'object', additionalProperties: false, required: ['startsAt', 'endsAt'],
        properties: {
          startsAt: { type: 'string', format: 'date-time', description: 'Future timestamp with time zone' },
          endsAt: { type: 'string', format: 'date-time', description: 'After startsAt; at most 24 hours later' },
        },
      },
      Booking: {
        type: 'object', required: ['id', 'providerId', 'slotId', 'serviceId', 'customerUserId', 'startsAt', 'endsAt', 'status', 'holdExpiresAt', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' }, providerId: { type: 'string', format: 'uuid' },
          slotId: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid' },
          customerUserId: { type: 'string', format: 'uuid' },
          startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['held', 'confirmed', 'rejected', 'cancelled', 'expired'] },
          holdExpiresAt: { type: 'string', format: 'date-time', nullable: true, description: 'Initial ten-minute hold deadline' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateBooking: {
        type: 'object', additionalProperties: false, required: ['slotId', 'serviceId', 'startsAt'],
        properties: {
          slotId: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid' },
          startsAt: { type: 'string', format: 'date-time', description: 'Requested start with time zone; end is calculated from service duration' },
        },
      },
      ProviderReview: {
        type: 'object', required: ['id', 'providerId', 'rating', 'reviewText', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          providerId: { type: 'string', format: 'uuid' },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          reviewText: { type: 'string', description: 'Untrusted customer text' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateProviderReview: {
        type: 'object', additionalProperties: false, required: ['rating', 'reviewText'],
        properties: {
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          reviewText: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
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
          providerDetails: { $ref: '#/components/schemas/ProviderInput' },
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
          providerDetails: { $ref: '#/components/schemas/ProviderUpdate' },
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
      get: {
        tags: ['Users'], summary: 'List users (admin only)', security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['customer', 'service_provider', 'admin'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 100000, default: 0 } },
        ],
        responses: {
          200: { description: 'User summaries', content: json(dataList('User')) },
          400: error('Invalid filter or pagination'), 401: error('Access token required or invalid'),
          403: error('Admin access required'), 500: error('Server error'),
        },
      },
      post: {
        tags: ['Users'], summary: 'Register a customer or service provider',
        description: 'Public registration cannot create admin accounts. providerDetails is optional for service_provider and forbidden for customer. When provided, registration creates the account and listing atomically.',
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
        tags: ['Users'], summary: 'Fetch user details', security: [{ bearerAuth: [] }],
        description: 'Users can fetch themselves; admins can fetch any user.',
        responses: {
          200: { description: 'User details', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } } },
          400: error('Invalid UUID'), 401: error('Access token required or invalid'),
          403: error('Not your account or admin'), 404: error('User not found'), 500: error('Server error'),
        },
      },
      patch: {
        tags: ['Users'], summary: 'Update user details', security: [{ bearerAuth: [] }],
        description: 'Users can update themselves; admins can update any user. The account role cannot be changed. A service provider may update providerDetails; if no listing exists, serviceType, serviceArea, and basePrice are required.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUser' } } } },
        responses: {
          200: { description: 'Updated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } } } },
          400: error('Invalid request'), 401: error('Access token required or invalid'),
          403: error('Not your account or admin'), 404: error('User not found'),
          409: error('Email already registered'), 500: error('Server error'),
        },
      },
      delete: {
        tags: ['Users'], summary: 'Delete an account', security: [{ bearerAuth: [] }],
        description: 'Users can delete themselves; admins can delete any user. Permanently removes the user record.',
        responses: {
          204: { description: 'Deleted' }, 400: error('Invalid UUID'),
          401: error('Access token required or invalid'), 403: error('Not your account or admin'),
          404: error('User not found'), 500: error('Server error'),
        },
      },
    },
    '/api/users/{id}/password': {
      parameters: [userId],
      patch: {
        tags: ['Auth'], summary: 'Change your password', security: [{ bearerAuth: [] }],
        description: 'Only the account owner can change their password, including for admin accounts. Returns a new access token; previously issued tokens become invalid.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangePassword' } } } },
        responses: {
          200: { description: 'New access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenResponse' } } } },
          400: error('Invalid request'), 401: error('Invalid token or current password'),
          403: error('Not your account'), 404: error('User not found'),
          409: error('Password changed concurrently'), 500: error('Server error'),
        },
      },
    },
    '/api/providers/{providerId}/services': {
      parameters: [providerId],
      get: {
        tags: ['Providers'], summary: 'List active services for a provider',
        responses: {
          200: { description: 'Up to 100 services', content: json(dataList('ServiceOffering')) },
          400: error('Invalid provider ID'), 404: error('Provider not found'), 500: error('Server error'),
        },
      },
      post: {
        tags: ['Providers'], summary: 'Create a service offering', security: [{ bearerAuth: [] }],
        description: 'Only the service provider who owns this listing can create a service.',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/CreateServiceOffering' }) },
        responses: {
          201: { description: 'Created', content: json(data('ServiceOffering')) },
          400: error('Invalid request'), 401: error('Access token required or invalid'),
          403: error('Not the provider owner'), 404: error('Provider not found'),
          409: error('Service name already exists'), 500: error('Server error'),
        },
      },
    },
    '/api/providers/{providerId}/slots': {
      parameters: [providerId],
      get: {
        tags: ['Providers'], summary: 'List upcoming provider slots',
        responses: {
          200: { description: 'Up to 100 slots', content: json(dataList('ProviderSlot')) },
          400: error('Invalid provider ID'), 404: error('Provider not found'), 500: error('Server error'),
        },
      },
      post: {
        tags: ['Providers'], summary: 'Create an available slot', security: [{ bearerAuth: [] }],
        description: 'Only the provider owner can create slots. Overlapping slots are rejected.',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/CreateProviderSlot' }) },
        responses: {
          201: { description: 'Created', content: json(data('ProviderSlot')) },
          400: error('Invalid request'), 401: error('Access token required or invalid'),
          403: error('Not the provider owner'), 404: error('Provider not found'),
          409: error('Slot overlaps'), 500: error('Server error'),
        },
      },
    },
    '/api/providers/{providerId}/reviews': {
      parameters: [providerId],
      get: {
        tags: ['Providers'], summary: 'List provider reviews',
        responses: {
          200: { description: 'Up to 100 newest reviews', content: json(dataList('ProviderReview')) },
          400: error('Invalid provider ID'), 404: error('Provider not found'), 500: error('Server error'),
        },
      },
      post: {
        tags: ['Providers'], summary: 'Add a customer review', security: [{ bearerAuth: [] }],
        description: 'Only authenticated customers can add reviews. The reviewer ID comes from the access token.',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/CreateProviderReview' }) },
        responses: {
          201: { description: 'Created', content: json(data('ProviderReview')) },
          400: error('Invalid request'), 401: error('Access token required or invalid'),
          403: error('Only customers can review'), 404: error('Provider not found'), 500: error('Server error'),
        },
      },
    },
    '/api/providers/{providerId}/bookings': {
      parameters: [providerId],
      get: {
        tags: ['Bookings'], summary: 'Provider lists booking requests', security: [{ bearerAuth: [] }],
        description: 'Only the listing owner can view these requests. Expired holds appear as expired.',
        responses: {
          200: { description: 'Up to 100 bookings', content: json(dataList('Booking')) },
          400: error('Invalid provider ID'), 401: error('Access token required'),
          403: error('Not the provider owner'), 404: error('Provider not found'),
        },
      },
      post: {
        tags: ['Bookings'], summary: 'Hold a provider time for ten minutes', security: [{ bearerAuth: [] }],
        description: 'Customers choose a start within an available provider slot. End is computed from the service duration. The provider accepts or rejects the request before its ten-minute hold expires. Overlapping confirmed bookings or active holds return 409.',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/CreateBooking' }) },
        responses: {
          201: { description: 'Booking hold created', content: json(data('Booking')) },
          400: error('Invalid input'), 401: error('Access token required'), 403: error('Only customers can book'),
          404: error('Service not found'), 409: error('Outside availability or overlapping booking'),
        },
      },
    },
    '/api/bookings': {
      get: {
        tags: ['Bookings'], summary: 'List my bookings', security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Up to 100 bookings', content: json(dataList('Booking')) },
          401: error('Access token required'), 403: error('Only customers can view bookings'),
        },
      },
    },
    '/api/bookings/{bookingId}/reschedule': {
      parameters: [{ name: 'bookingId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      patch: {
        tags: ['Bookings'], summary: 'Reschedule my rejected booking', security: [{ bearerAuth: [] }],
        description: 'Only the customer who owns a rejected booking can choose a new available slot and service with the same provider. The booking keeps its ID and returns to held with a fresh ten-minute deadline. The provider must accept or reject again.',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/CreateBooking' }) },
        responses: {
          200: { description: 'Rescheduled booking hold', content: json(data('Booking')) },
          400: error('Invalid booking ID or time'), 401: error('Access token required'),
          403: error('Only customers can reschedule'), 404: error('Booking or active service not found'),
          409: error('Booking is not rejected or new time overlaps another booking'),
        },
      },
    },
    '/api/providers/{providerId}/bookings/{bookingId}/accept': {
      parameters: [providerId, { name: 'bookingId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      patch: {
        tags: ['Bookings'], summary: 'Provider accepts an active hold', security: [{ bearerAuth: [] }],
        description: 'Only the listing owner can accept before holdExpiresAt; acceptance confirms the booking.',
        responses: {
          200: { description: 'Confirmed booking', content: json(data('Booking')) },
          400: error('Invalid ID'), 401: error('Access token required'), 403: error('Not the provider owner'),
          404: error('Provider or booking not found'), 409: error('Hold expired or already decided'),
        },
      },
    },
    '/api/providers/{providerId}/bookings/{bookingId}/reject': {
      parameters: [providerId, { name: 'bookingId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      patch: {
        tags: ['Bookings'], summary: 'Provider rejects an active hold', security: [{ bearerAuth: [] }],
        description: 'Only the listing owner can reject before holdExpiresAt; the time becomes available immediately.',
        responses: {
          200: { description: 'Rejected booking', content: json(data('Booking')) },
          400: error('Invalid ID'), 401: error('Access token required'), 403: error('Not the provider owner'),
          404: error('Provider or booking not found'), 409: error('Hold expired or already decided'),
        },
      },
    },
  },
};
