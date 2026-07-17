import { op, jsonBody, idParam } from '../helpers.js';

export function birthdaysPaths() {
  return {
    '/api/v1/birthdays': {
      get: op({ summary: 'List birthdays', tag: 'Birthdays' }),
      post: op({ summary: 'Create birthday', tag: 'Birthdays', stateChanging: true, requestBody: jsonBody(null) }),
    },
    '/api/v1/birthdays/upcoming': {
      get: op({ summary: 'List upcoming birthdays', tag: 'Birthdays' }),
    },
    '/api/v1/birthdays/meta/options': {
      get: op({ summary: 'Get birthday upload options', tag: 'Birthdays' }),
    },
    '/api/v1/birthdays/{id}': {
      put: op({ summary: 'Update birthday', tag: 'Birthdays', params: [idParam()], stateChanging: true, requestBody: jsonBody(null) }),
      delete: op({ summary: 'Delete birthday', tag: 'Birthdays', params: [idParam()], stateChanging: true }),
    },
  };
}
