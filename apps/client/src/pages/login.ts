import { loginSchema } from '@tillhaven/shared';
import { api } from '../net/api.js';
import { initAuthForm } from './auth-form.js';

initAuthForm({
  schema: loginSchema,

  /*
   * INVALID_CREDENTIALS is deliberately NOT mapped to a field. The server
   * returns the same answer for a wrong password and an account that does not
   * exist, and pinning the message to one input would undo that — it would
   * tell an attacker which of the two was wrong.
   */
  onSubmit: async (values) => {
    await api.post('/auth/login', {
      identifier: values['identifier'],
      password: values['password'],
    });

    window.location.assign('/play');
  },
});
