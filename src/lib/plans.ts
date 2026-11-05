/** Legacy database enum values only. They grant no permissions and have no billing behavior. */
export const PLAN_VALUES = ["free", "pro"] as const;
export const PLAN_SOURCE_VALUES = ["stripe_test", "simulated", "manual"] as const;
