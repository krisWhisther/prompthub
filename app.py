"""PromptHub : le serveur (Python + Flask + SQLite)."""

import sqlite3
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request

DOSSIER = Path(__file__).resolve().parent
CHEMIN_BASE = DOSSIER / "prompthub.db"
CHEMIN_SCHEMA = DOSSIER / "schema.sql"

CATEGORIES = ["Productivité", "Code", "Écriture", "Apprentissage"]

app = Flask(__name__)


# ---------- Base de données ----------
def get_db():
    """Ouvre la base une seule fois par requête."""
    if "db" not in g:
        g.db = sqlite3.connect(CHEMIN_BASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def fermer_db(erreur=None):
    """Ferme la base à la fin de chaque requête."""
    db = g.pop("db", None)
    if db is not None:
        db.close()
        
        
def initialiser_db():
    """Crée la table et ajoute les prompts de départ (voir schema.sql)."""
    connexion = sqlite3.connect(CHEMIN_BASE)
    try:
        connexion.executescript(CHEMIN_SCHEMA.read_text(encoding="utf-8"))
        connexion.commit()
    finally:
        connexion.close()
        
        
def nettoyer(valeur):
    """Renvoie le texte sans espaces autour, ou '' si ce n'est pas du texte."""
    return valeur.strip() if isinstance(valeur, str) else ""


def ligne_en_dict(ligne):
    return {
        "id": ligne["id"],
        "titre": ligne["titre"],
        "contenu": ligne["contenu"],
        "categorie": ligne["categorie"],
        "likes": ligne["likes"],
    }
    
    
# ---------- Pages ----------
@app.get("/")
def accueil():
    return render_template("index.html", categories=CATEGORIES)
    
    
# ---------- API ----------
@app.get("/api/prompts")
def lister_prompts():
    recherche = request.args.get("q", "").strip()
    categorie = request.args.get("categorie", "").strip()
    
    requete = "SELECT id, titre, contenu, categorie, likes FROM prompts WHERE 1 = 1"
    parametres = []
        
    if recherche:
        requete += " AND (titre LIKE ? OR contenu LIKE ?)"
        parametres.extend([f"%{recherche}%", f"%{recherche}%"])
    if categorie:
        requete += " AND categorie = ?"
        parametres.append(categorie)
        
    requete += " ORDER BY likes DESC, id DESC"
    
    lignes = get_db().execute(requete, parametres).fetchall()
    return jsonify([ligne_en_dict(ligne) for ligne in lignes])
    
    
@app.post("/api/prompts")
def creer_prompt():
    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400
    
    titre = nettoyer(donnees.get("titre"))
    contenu = nettoyer(donnees.get("contenu"))
    categorie = nettoyer(donnees.get("categorie"))
    
    if not 3 <= len(titre) <= 60:
        return jsonify({"erreur": "Le titre doit faire entre 3 et 60 caractères."}), 400
    if not 10 <= len(contenu) <= 500:
        return jsonify({"erreur": "Le prompt doit faire entre 10 et 500 caractères."}), 400
    if categorie not in CATEGORIES:
        return jsonify({"erreur": "Catégorie inconnue."}), 400
    
    db = get_db()
    try:
        curseur = db.execute(
            "INSERT INTO prompts (titre, contenu, categorie) VALUES (?, ?, ?)",
            (titre, contenu, categorie),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"erreur": "Un prompt avec ce titre existe déjà."}), 409
    
    nouveau = {
        "id": curseur.lastrowid,
        "titre": titre,
        "contenu": contenu,
        "categorie": categorie,
        "likes": 0,
    }
    return jsonify(nouveau), 201


@app.post("/api/prompts/<int:prompt_id>/like")
def aimer_prompt(prompt_id):
    db = get_db()
    curseur = db.execute("UPDATE prompts SET likes = likes + 1 WHERE id = ?", (prompt_id,))
    db.commit()
    
    if curseur.rowcount == 0:
        return jsonify({"erreur": "Prompt introuvable."}), 404
    
    ligne = db.execute("SELECT likes FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
    return jsonify({"likes": ligne["likes"]})


@app.get("/api/stats")
def statistiques():
    db = get_db()
    totaux = db.execute(
        "SELECT COUNT(*) AS total, COALESCE(SUM(likes), 0) AS likes FROM prompts"
    ).fetchone()
    lignes = db.execute(
        "SELECT categorie, COUNT(*) AS nombre FROM prompts "
        "GROUP BY categorie ORDER BY nombre DESC, categorie"
    ).fetchall()
    
    return jsonify(
        {
            "total_prompts": totaux["total"],
            "total_likes": totaux["likes"],
            "par_categorie": [
                {"categorie": ligne["categorie"], "nombre": ligne["nombre"]} for ligne in lignes
            ],
        }
    )
    
    
# ---------- Démarrage ----------
initialiser_db()

if __name__ == "__main__":
    app.run(debug=True, port=5050)
        