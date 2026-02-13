const Cookies = {
  // Return empty cookie jar by default in tests
  get: async (_url: string) => ({}),
  set: async () => {},
  clearAll: async () => {},
}

export default Cookies
