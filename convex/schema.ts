import { defineSchema } from "convex/server";
import { bookingTables } from "./tables/bookings";
import { planTables } from "./tables/plans";
import { profileTables } from "./tables/profiles";
import { questTables } from "./tables/quests";
import { roomTables } from "./tables/rooms";
import { venueTables } from "./tables/venues";
export { answerValidator, moodValidator, proposalKindValidator, slotValidator, stopValidator } from "./validators";

export default defineSchema({
  ...profileTables,
  ...venueTables,
  ...roomTables,
  ...questTables,
  ...planTables,
  ...bookingTables,
});
