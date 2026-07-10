import { useSyncExternalStore } from 'react'

import type { PlanningController } from './planning-controller'

export function usePlanningController(controller: PlanningController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}
