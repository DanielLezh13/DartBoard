export type Database = {
  public: {
    Tables: {
      // Add your table types here
      [_ in string]: never
    }
  }
}
