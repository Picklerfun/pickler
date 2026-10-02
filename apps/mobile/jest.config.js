module.exports = {
  preset: "jest-expo",
  // Workspace packages and hoisted modules are transformed where they live, outside this directory;
  // the helpers Babel adds to them (@babel/runtime) are installed here.
  modulePaths: ["<rootDir>/node_modules"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@category-labs/.*|viem|@scure/.*|@noble/.*)",
  ],
};
