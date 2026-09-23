"""'Hooks' tab: replay scenarios and try arbitrary commands against the dispatcher."""
import queue
import threading
import tkinter as tk
from tkinter import ttk

from runner import PROFILES, Sandbox, run_call, run_scenarios
from scenarios import SCENARIOS, bash, write

MARK = {True: "✓ conforme", False: "✗ écart"}


class HooksTab(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=8)
        self.events = queue.Queue()
        self.profile = tk.StringVar(value="standard")
        self._build_toolbar()
        self._build_table()
        self._build_custom()
        self.after(100, self._drain)

    # ------------------------------------------------------------------ layout
    def _build_toolbar(self):
        bar = ttk.Frame(self)
        bar.pack(fill="x")
        ttk.Label(bar, text="Profil :").pack(side="left")
        ttk.Combobox(bar, textvariable=self.profile, values=PROFILES,
                     width=10, state="readonly").pack(side="left", padx=4)
        self.run_btn = ttk.Button(bar, text="Lancer tous les scénarios", command=self.run_all)
        self.run_btn.pack(side="left", padx=8)
        self.summary = ttk.Label(bar, text="")
        self.summary.pack(side="left", padx=8)

    def _build_table(self):
        cols = ("cat", "name", "expect", "got", "result")
        self.tree = ttk.Treeview(self, columns=cols, show="headings", height=13)
        for col, title, width in zip(cols, ("Catégorie", "Scénario", "Attendu", "Obtenu", "Résultat"),
                                     (110, 290, 70, 70, 100)):
            self.tree.heading(col, text=title)
            self.tree.column(col, width=width, anchor="w")
        self.tree.tag_configure("pass", foreground="#1f8a3b")
        self.tree.tag_configure("fail", foreground="#c62828")
        self.tree.pack(fill="both", expand=True, pady=6)
        self.tree.bind("<<TreeviewSelect>>", self._show_detail)
        self.detail = tk.Text(self, height=6, wrap="word")
        self.detail.pack(fill="x")
        self.messages = {}
        for i, sc in enumerate(SCENARIOS):
            self.tree.insert("", "end", iid=str(i), values=(sc["category"], sc["name"], sc["expect"], "", ""))

    def _build_custom(self):
        box = ttk.LabelFrame(self, text="Essayer ma propre commande", padding=6)
        box.pack(fill="x", pady=(8, 0))
        self.kind = tk.StringVar(value="bash")
        ttk.Radiobutton(box, text="Commande Bash", variable=self.kind, value="bash").grid(row=0, column=0, sticky="w")
        ttk.Radiobutton(box, text="Écriture de fichier :", variable=self.kind, value="write").grid(row=0, column=1, sticky="w")
        self.path = ttk.Entry(box, width=32)
        self.path.insert(0, "migrations/010_test.sql")
        self.path.grid(row=0, column=2, sticky="w", padx=4)
        self.input = tk.Text(box, height=4, wrap="word")
        self.input.grid(row=1, column=0, columnspan=4, sticky="ew", pady=4)
        ttk.Button(box, text="Tester", command=self.run_custom).grid(row=2, column=0, sticky="w")
        self.custom_result = ttk.Label(box, text="", wraplength=700, justify="left")
        self.custom_result.grid(row=2, column=1, columnspan=3, sticky="w")
        box.columnconfigure(3, weight=1)

    # ----------------------------------------------------------------- actions
    def run_all(self):
        self.run_btn.state(["disabled"])
        self.summary.config(text="en cours…")
        profile = self.profile.get()

        def work():
            passed = 0
            for i, (sc, res) in enumerate(run_scenarios(SCENARIOS, profile)):
                passed += res["pass"]
                self.events.put(("row", i, res))
            self.events.put(("done", passed, len(SCENARIOS)))

        threading.Thread(target=work, daemon=True).start()

    def run_custom(self):
        text = self.input.get("1.0", "end").rstrip("\n")
        if not text.strip():
            self.custom_result.config(text="Écris une commande ou un contenu d'abord.")
            return
        call = bash(text) if self.kind.get() == "bash" else write(self.path.get().strip() or "fichier.txt", text + "\n")
        profile = self.profile.get()
        self.custom_result.config(text="en cours…")

        def work():
            sandbox = Sandbox()
            try:
                self.events.put(("custom", run_call(call, profile, sandbox)))
            finally:
                sandbox.close()

        threading.Thread(target=work, daemon=True).start()

    # ------------------------------------------------------------ UI updates
    def _drain(self):
        try:
            while True:
                self._apply(self.events.get_nowait())
        except queue.Empty:
            pass
        self.after(100, self._drain)

    def _apply(self, event):
        kind = event[0]
        if kind == "row":
            _, i, res = event
            self.messages[str(i)] = res["message"]
            vals = list(self.tree.item(str(i), "values"))
            vals[3], vals[4] = res["verdict"], MARK[res["pass"]]
            self.tree.item(str(i), values=vals, tags=("pass" if res["pass"] else "fail",))
        elif kind == "done":
            _, passed, total = event
            self.summary.config(text="%d/%d conformes" % (passed, total))
            self.run_btn.state(["!disabled"])
        elif kind == "custom":
            res = event[1]
            label = {"refus": "REFUSÉ (exit 2)", "avert": "AVERTISSEMENT (exit 0)",
                     "ok": "AUTORISÉ, silencieux (exit 0)"}.get(res["verdict"], "ERREUR (exit %s)" % res["code"])
            self.custom_result.config(text=label + ("\n" + res["message"] if res["message"] else ""))

    def _show_detail(self, _event):
        sel = self.tree.selection()
        self.detail.delete("1.0", "end")
        if sel:
            self.detail.insert("1.0", self.messages.get(sel[0], "(pas encore lancé)") or "(aucun message : sortie silencieuse)")
