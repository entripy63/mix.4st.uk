import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules/', 'vendor/', 'docs/', '*.bak*']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Audio: 'readonly',
        AudioContext: 'readonly',
        OfflineAudioContext: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        alert: 'readonly',
        // App globals
        state: 'writable',
        storage: 'writable',
        browserModes: 'writable',
        searchIndex: 'writable',
        liveStreams: 'writable',
        liveStreamsInitialized: 'writable',
        // Imported functions (called across file boundaries)
        fetchDJMixes: 'readonly',
        escapeHtml: 'readonly',
        playLive: 'readonly',
        addUserStream: 'readonly',
        showConfirmDialog: 'readonly',
        getUserStreams: 'readonly',
        saveUserStreams: 'readonly',
        initLiveStreams: 'readonly',
        getAvailableCategories: 'readonly',
        hidePresetsMenu: 'readonly',
        showToast: 'readonly',
        displaySearchResults: 'readonly',
        fetchPlaylist: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'off',
      'semi': ['warn', 'always'],
      'quotes': 'off'
    }
  }
];
