import { state } from "./state.js";

function getWidgetOrder() {
  return state.workspace.widgets.map((widget) => widget.id);
}

function reorderWidgets(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const widgets = [...state.workspace.widgets];
  const fromIndex = widgets.findIndex((item) => item.id === fromId);
  const toIndex = widgets.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;

  const [moved] = widgets.splice(fromIndex, 1);
  widgets.splice(toIndex, 0, moved);
  state.workspace.widgets = widgets;
}

function syncDomToState() {
  const grid = document.querySelector(".workspace-grid");
  if (!grid) return;
  const orderedIds = getWidgetOrder();
  orderedIds.forEach((id) => {
    const element = grid.querySelector(`[data-widget-id="${id}"]`);
    if (element) grid.appendChild(element);
  });
}

export function setupWidgetDragAndDrop() {
  const widgetElements = document.querySelectorAll("[data-widget-id]");
  if (!widgetElements.length) return;

  widgetElements.forEach((element) => {
    element.setAttribute("draggable", "true");

    element.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", element.dataset.widgetId);
      element.classList.add("widget-dragging");
    });

    element.addEventListener("dragend", () => {
      element.classList.remove("widget-dragging");
      document.querySelectorAll(".widget-drop-target").forEach((node) => node.classList.remove("widget-drop-target"));
    });

    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      element.classList.add("widget-drop-target");
    });

    element.addEventListener("dragleave", () => {
      element.classList.remove("widget-drop-target");
    });

    element.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromId = event.dataTransfer.getData("text/plain");
      const toId = element.dataset.widgetId;
      reorderWidgets(fromId, toId);
      syncDomToState();
      element.classList.remove("widget-drop-target");
    });
  });
}
