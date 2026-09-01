import { registerSchema } from '@tillhaven/shared';
import { api } from '../net/api.js';
import { initAuthForm } from './auth-form.js';

initAuthForm({
  schema: registerSchema,

  // A taken name or email belongs against the field that caused it, not in a
  // banner at the bottom of the form.
  fieldForCode: {
    USERNAME_TAKEN: 'username',
    EMAIL_TAKEN: 'email',
  },

  onSubmit: async (values) => {
    /*
     * The server creates the player, the farm and every plot in one
     * transaction, then sets an httpOnly session cookie. Nothing about the new
     * account is decided here — the client only reports what it was told.
     */
    await api.post('/auth/register', {
      username: values['username'],
      email: values['email'],
      password: values['password'],
    });

    window.location.assign('/play');
  },
});
