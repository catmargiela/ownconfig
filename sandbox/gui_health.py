"""'Santé' tab: run the health checks and preview the status line in color."""
import queue
import threading
import tkinter as tk
from tkinter import ttk

import ansi
from health import CHECKS

ICON = {"ok": "✓ ok", "warn": "! à voir", "fail": "✗ échec"}
COLOR = {"ok": "#1f8a3b", "warn": "#b26a00", "fail": "#c62828"}


class HealthTab(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=8)
        self.events = queue.Queue()
        self.details = {}
        bar = ttk.Frame(self)
        bar.pack(fill="x")
        self.run_btn = ttk.Button(bar, text="Lancer les contrôles", command=self.run_all)
        self.run_btn.pack(side="left")
        self.summary = ttk.Label(bar, text="")
        self.summary.pack(side="left", padx=8)

        self.tree = ttk.Treeview(self, columns=("check", "status", "summary"), show="headings", height=7)
        for col, title, width in (("check", "Contrôle", 250), ("status", "Statut", 90), ("summary", "Résumé", 420)):
            self.tree.heading(col, text=title)
            self.tree.column(col, width=width, anchor="w")
        for status, color in COLOR.items():
            self.tree.tag_configure(status, foreground=color)
        for i, (name, _fn) in enumerate(CHECKS):
            self.tree.insert("", "end", iid=str(i), values=(name, "", ""))
        self.tree.pack(fill="x", pady=6)
        self.tree.bind("<<TreeviewSelect>>", self._show_detail)

        ttk.Label(self, text="Aperçu de la barre de statut (données d'exemple) :").pack(anchor="w", pady=(6, 0))
        self.preview = tk.Text(self, height=2, wrap="none", background="#1e1e1e",
                               foreground="#d4d4d4", font=("Menlo", 12))
        self.preview.pack(fill="x")
        ttk.Label(self, text="Détail :").pack(anchor="w", pady=(6, 0))
        self.detail = tk.Text(self, height=12, wrap="word", font=("Menlo", 11))
        self.detail.pack(fill="both", expand=True)
        self.after(100, self._drain)

    def run_all(self):
        self.run_btn.state(["disabled"])
        self.summary.config(text="en cours… (le serveur MCP peut prendre quelques secondes)")

        def work():
            counts = {"ok": 0, "warn": 0, "fail": 0}
            for i, (name, fn) in enumerate(CHECKS):
                try:
                    status, summary, detail = fn()
                except Exception as exc:  # a broken check must not kill the UI
                    status, summary, detail = "fail", "erreur interne", repr(exc)
                counts[status] += 1
                self.events.put(("row", i, status, summary, detail, name))
            self.events.put(("done", counts))

        threading.Thread(target=work, daemon=True).start()

    def _drain(self):
        try:
            while True:
                self._apply(self.events.get_nowait())
        except queue.Empty:
            pass
        self.after(100, self._drain)

    def _apply(self, event):
        if event[0] == "row":
            _, i, status, summary, detail, name = event
            self.details[str(i)] = detail
            self.tree.item(str(i), values=(name, ICON[status], summary), tags=(status,))
            if name == "Barre de statut" and status == "ok":
                self._render_preview(detail)
        else:
            counts = event[1]
            self.summary.config(text="%d ok · %d à voir · %d échec" % (counts["ok"], counts["warn"], counts["fail"]))
            self.run_btn.state(["!disabled"])

    def _render_preview(self, text):
        self.preview.config(state="normal")
        self.preview.delete("1.0", "end")
        for n, (chunk, fg, bold, dim) in enumerate(ansi.runs(text)):
            tag = "run%d" % n
            font = ("Menlo", 12, "bold") if bold else ("Menlo", 12)
            self.preview.tag_configure(tag, foreground=("#6e6e6e" if dim and not fg else fg or "#d4d4d4"), font=font)
            self.preview.insert("end", chunk, tag)
        self.preview.config(state="disabled")

    def _show_detail(self, _event):
        sel = self.tree.selection()
        self.detail.delete("1.0", "end")
        if sel:
            self.detail.insert("1.0", self.details.get(sel[0], "(pas encore lancé)"))
