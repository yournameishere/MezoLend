"use client";

import { createContext } from "react";
import type { MarketsSnapshot } from "./server-data";

/** Market data rendered on the server, used as the initial value of the live client query. */
export const MarketsSeed = createContext<{ data: MarketsSnapshot; at: number }>({ data: undefined, at: 0 });
