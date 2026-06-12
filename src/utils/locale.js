'use strict';

const normalizeLocale = (lang) => (lang === 'en' ? 'en' : 'vi');

module.exports = { normalizeLocale };
