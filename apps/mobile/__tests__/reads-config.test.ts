import { READS_URL_DEFAULT } from "../src/reads/constants";

test("the reads service lives in the pickler Supabase project (F1)", () => {
  expect(READS_URL_DEFAULT).toBe("https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1");
});
