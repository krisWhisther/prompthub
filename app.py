"""PromptHub : le serveur (Python + Flask + SQLite)."""

import hashlib
import json
import re
import secrets
import smtplib
import sqlite3
import unicodedata
from datetime import datetime, timedelta
from email.message import EmailMessage
from functools import wraps
from pathlib import Path

from authlib.integrations.flask_client import OAuth
from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

DOSSIER = Path(__file__).resolve().parent
CHEMIN_BASE = DOSSIER / "prompthub.db"
CHEMIN_SCHEMA = DOSSIER / "schema.sql"
CHEMIN_CLE = DOSSIER / "secret_key.txt"
CHEMIN_OAUTH = DOSSIER / "oauth_config.json"
CHEMIN_EMAIL = DOSSIER / "email_config.json"
CHEMIN_ADMIN = DOSSIER / "admin_config.json"

# Catégories de la bibliothèque (liste encore amenée à grandir, voir le questionnaire
# de publication évoqué par Kris : pour l'instant, l'auteur choisit sa catégorie dans
# cette liste via un menu déroulant, voir creer_prompt/modifier_prompt ci-dessous).
CATEGORIES = [
    "Création de contenu",
    "Éditeurs de photo (IA)",
    "Analyse, correction, résumé et restructuration de texte",
    "Code et programmation / Dev Web",
    "Tout pour le e-commerce et le marketing",
]
DUREE_JETON_RESET = timedelta(minutes=30)

app = Flask(__name__)


def obtenir_cle_secrete():
    """Lit la clé secrète du site, ou en crée une nouvelle au premier lancement.

    Cette clé sert à signer les sessions (la mémoire de connexion des visiteurs).
    Elle ne doit jamais être partagée ni envoyée sur GitHub (voir .gitignore).
    """
    if not CHEMIN_CLE.exists():
        CHEMIN_CLE.write_text(secrets.token_hex(32), encoding="utf-8")
    return CHEMIN_CLE.read_text(encoding="utf-8").strip()


app.secret_key = obtenir_cle_secrete()


# ---------- Connexion sociale (Google, GitHub, Facebook, LinkedIn) ----------
# Les identifiants de chaque réseau vivent dans oauth_config.json (jamais sur
# GitHub, voir .gitignore). Tant qu'un réseau n'y a pas ses identifiants, son
# bouton reste affiché mais indique "Bientôt disponible" (voir page_connexion).
def obtenir_config_oauth():
    """Lit oauth_config.json. Un fichier absent ou invalide donne juste {}."""
    if not CHEMIN_OAUTH.exists():
        return {}
    try:
        return json.loads(CHEMIN_OAUTH.read_text(encoding="utf-8"))
    except ValueError:
        return {}


CONFIG_OAUTH = obtenir_config_oauth()
FOURNISSEURS_ACTIFS = {
    nom: valeurs
    for nom, valeurs in CONFIG_OAUTH.items()
    if valeurs.get("client_id") and valeurs.get("client_secret")
}

FOURNISSEURS_AFFICHAGE = [
    {"id": "google", "lettre": "G", "nom": "Google"},
    {"id": "facebook", "lettre": "f", "nom": "Facebook"},
    {"id": "github", "lettre": "GH", "nom": "GitHub"},
    {"id": "linkedin", "lettre": "in", "nom": "LinkedIn"},
]

# Les adresses de chaque réseau : où envoyer la demande, où récupérer le profil.
FOURNISSEURS_INFOS = {
    "google": {
        "server_metadata_url": "https://accounts.google.com/.well-known/openid-configuration",
        "client_kwargs": {"scope": "openid email profile"},
    },
    "facebook": {
        "authorize_url": "https://www.facebook.com/v21.0/dialog/oauth",
        "access_token_url": "https://graph.facebook.com/v21.0/oauth/access_token",
        "api_base_url": "https://graph.facebook.com/v21.0/",
        "client_kwargs": {"scope": "email public_profile"},
    },
    "github": {
        "authorize_url": "https://github.com/login/oauth/authorize",
        "access_token_url": "https://github.com/login/oauth/access_token",
        "api_base_url": "https://api.github.com/",
        "client_kwargs": {"scope": "read:user user:email"},
    },
    "linkedin": {
        "server_metadata_url": "https://www.linkedin.com/oauth/.well-known/openid-configuration",
        "client_kwargs": {"scope": "openid profile email"},
        "token_endpoint_auth_method": "client_secret_post",
    },
}

oauth = OAuth(app)
for nom_fournisseur, infos in FOURNISSEURS_INFOS.items():
    if nom_fournisseur in FOURNISSEURS_ACTIFS:
        oauth.register(
            nom_fournisseur,
            client_id=FOURNISSEURS_ACTIFS[nom_fournisseur]["client_id"],
            client_secret=FOURNISSEURS_ACTIFS[nom_fournisseur]["client_secret"],
            **infos,
        )


# ---------- Envoi d'e-mails (mot de passe oublié) ----------
# Les identifiants du compte expéditeur vivent dans email_config.json (jamais sur
# GitHub, voir .gitignore). Tant que ce fichier n'existe pas, envoyer_email_reinitialisation
# affiche simplement le lien dans la console du serveur : pratique pour développer et
# tester tout le parcours sans avoir à configurer un vrai compte e-mail.
def obtenir_config_email():
    """Lit email_config.json. Un fichier absent ou invalide donne juste {}."""
    if not CHEMIN_EMAIL.exists():
        return {}
    try:
        return json.loads(CHEMIN_EMAIL.read_text(encoding="utf-8"))
    except ValueError:
        return {}


CONFIG_EMAIL = obtenir_config_email()


# ---------- Administration ----------
# admin_config.json (jamais sur GitHub, voir .gitignore et admin_config.example.json)
# contient juste la liste des e-mails administrateurs. Dès qu'un compte avec un de
# ces e-mails se connecte ou s'inscrit, il reçoit les droits admin (voir
# promouvoir_si_admin) : pas besoin de modifier la base de données à la main.
def obtenir_config_admin():
    """Lit admin_config.json. Un fichier absent ou invalide donne juste {}."""
    if not CHEMIN_ADMIN.exists():
        return {}
    try:
        return json.loads(CHEMIN_ADMIN.read_text(encoding="utf-8"))
    except ValueError:
        return {}


CONFIG_ADMIN = obtenir_config_admin()
EMAILS_ADMIN = {adresse.lower() for adresse in CONFIG_ADMIN.get("emails", [])}


def promouvoir_si_admin(utilisateur_id, email, db):
    """Donne les droits administrateur à un compte dont l'e-mail figure dans
    EMAILS_ADMIN (voir admin_config.json). Appelé à chaque connexion/inscription :
    un compte déjà admin le reste même si on retire son e-mail du fichier ensuite
    (il faudrait alors modifier la base à la main pour le retirer)."""
    if email and email.lower() in EMAILS_ADMIN:
        db.execute("UPDATE utilisateurs SET est_admin = 1 WHERE id = ?", (utilisateur_id,))
        db.commit()


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
    connexion.row_factory = sqlite3.Row
    try:
        connexion.executescript(CHEMIN_SCHEMA.read_text(encoding="utf-8"))
        migrer_colonnes_manquantes(connexion)
        connexion.commit()
    finally:
        connexion.close()


def migrer_colonnes_manquantes(connexion):
    """Ajoute les colonnes ajoutées après la création initiale de la table à une base
    plus ancienne (connexion sociale, puis e-mail, puis nom/prénom/email_verifie,
    puis est_admin).

    Si prompthub.db vient d'une ancienne version du projet, mot_de_passe_hash y est
    encore obligatoire : supprime ce fichier une fois pour repartir d'une base propre
    si tu veux tester la connexion sociale sur un compte existant.
    """
    colonnes = {ligne["name"] for ligne in connexion.execute("PRAGMA table_info(utilisateurs)")}
    for colonne, type_sql in (
        ("fournisseur", "TEXT"),
        ("identifiant_externe", "TEXT"),
        ("email", "TEXT"),
        ("nom", "TEXT"),
        ("prenom", "TEXT"),
        ("email_verifie", "INTEGER NOT NULL DEFAULT 0"),
        ("est_admin", "INTEGER NOT NULL DEFAULT 0"),
    ):
        if colonne not in colonnes:
            connexion.execute(f"ALTER TABLE utilisateurs ADD COLUMN {colonne} {type_sql}")

    # Index unique posé ici (et pas directement dans le CREATE TABLE de schema.sql) :
    # il doit être créé après coup pour une base ancienne, une fois la colonne email
    # ajoutée ci-dessus. NULL est autorisé plusieurs fois (comptes sans e-mail connu).
    connexion.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_utilisateurs_email ON utilisateurs(email)")


def nettoyer(valeur):
    """Renvoie le texte sans espaces autour, ou '' si ce n'est pas du texte."""
    return valeur.strip() if isinstance(valeur, str) else ""


def texte_ou_vide(valeur):
    """Comme nettoyer(), mais sans retirer les espaces (utile pour un mot de passe)."""
    return valeur if isinstance(valeur, str) else ""


def nom_propre_valide(valeur):
    """Un nom ou un prénom fait 2 à 50 caractères, sans chiffre (voir inscription())."""
    return 2 <= len(valeur) <= 50 and not any(caractere.isdigit() for caractere in valeur)


def email_valide(email):
    """Vérifie un format simple : quelque chose@quelque-chose.quelque-chose, sans espaces."""
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email))


def mot_de_passe_valide(mot_de_passe):
    """8 caractères minimum, avec au moins une majuscule, un chiffre et un symbole."""
    if len(mot_de_passe) < 8:
        return False
    a_majuscule = any(caractere.isupper() for caractere in mot_de_passe)
    a_chiffre = any(caractere.isdigit() for caractere in mot_de_passe)
    a_symbole = any(not caractere.isalnum() for caractere in mot_de_passe)
    return a_majuscule and a_chiffre and a_symbole


def nom_utilisateur_depuis_profil(brut):
    """Fabrique un pseudo valide (3 à 20 caractères) à partir du profil d'un réseau social."""
    nettoye = re.sub(r"[^A-Za-z0-9_]", "", (brut or "").replace(" ", "_"))
    nettoye = nettoye[:20]
    return nettoye if len(nettoye) >= 3 else ""


def nom_utilisateur_disponible(nom, db):
    ligne = db.execute("SELECT 1 FROM utilisateurs WHERE nom_utilisateur = ?", (nom,)).fetchone()
    return ligne is None


def nom_utilisateur_unique(base, db):
    """Ajoute un numéro à la fin du pseudo si celui-ci est déjà pris (ex : kris2, kris3...)."""
    base = base or "membre"
    if nom_utilisateur_disponible(base, db):
        return base

    compteur = 2
    while True:
        suffixe = str(compteur)
        candidat = base[: 20 - len(suffixe)] + suffixe
        if nom_utilisateur_disponible(candidat, db):
            return candidat
        compteur += 1


def translitterer(texte):
    """Remplace les lettres accentuées par leur équivalent simple (é -> e, ç -> c,
    ö -> o...), pour que le pseudo généré automatiquement reste lisible plutôt que de
    perdre purement et simplement ces lettres (voir pseudo_depuis_identite)."""
    decompose = unicodedata.normalize("NFKD", texte)
    return "".join(caractere for caractere in decompose if not unicodedata.combining(caractere))


def pseudo_depuis_identite(nom, prenom, db):
    """Fabrique le pseudo d'un compte inscrit par e-mail, à partir du prénom et du nom,
    suivis de 3 chiffres choisis par le système pour le rendre unique (ex : JeanKossou482).

    L'utilisateur ne choisit plus son pseudo lui-même (voir inscription()) : il s'en
    sert seulement pour se connecter ensuite (en plus de son e-mail).
    """
    base = re.sub(r"[^A-Za-z0-9]", "", translitterer(f"{prenom}{nom}"))
    base = base[:17] or "membre"

    for _ in range(20):
        candidat = f"{base}{secrets.randbelow(900) + 100}"
        if nom_utilisateur_disponible(candidat, db):
            return candidat

    # Dans le cas très improbable où les 20 essais aléatoires sont tous déjà pris :
    # on retombe sur un compteur classique (jeankossou2, jeankossou3...).
    return nom_utilisateur_unique(base, db)


def extraire_profil(fournisseur, client, jeton):
    """Renvoie (identifiant_externe, nom_affiche) à partir de la réponse du réseau social."""
    if fournisseur in ("google", "linkedin"):
        profil = jeton.get("userinfo") or {}
        identifiant = profil.get("sub")
        nom = profil.get("name") or profil.get("given_name") or ""
        return (str(identifiant), nom) if identifiant else (None, "")

    if fournisseur == "github":
        profil = client.get("user").json()
        identifiant = profil.get("id")
        nom = profil.get("login") or profil.get("name") or ""
        return (str(identifiant), nom) if identifiant else (None, "")

    if fournisseur == "facebook":
        profil = client.get("me", params={"fields": "id,name"}).json()
        identifiant = profil.get("id")
        nom = profil.get("name") or ""
        return (str(identifiant), nom) if identifiant else (None, "")

    return (None, "")


# ---------- Mot de passe oublié ----------
def generer_jeton_reset(utilisateur_id, db):
    """Crée un jeton de réinitialisation à usage unique, valable 30 minutes.

    Seul le hash du jeton part en base : si quelqu'un lisait la base de données, il
    ne pourrait pas reconstituer un lien de réinitialisation valide à partir de ça.
    Le jeton en clair, lui, n'existe que dans le lien envoyé (ou affiché, voir
    envoyer_email_reinitialisation).
    """
    jeton = secrets.token_urlsafe(32)
    jeton_hash = hashlib.sha256(jeton.encode("utf-8")).hexdigest()
    expire_le = (datetime.utcnow() + DUREE_JETON_RESET).isoformat()
    db.execute(
        "INSERT INTO reinitialisations_mot_de_passe (utilisateur_id, jeton_hash, expire_le) VALUES (?, ?, ?)",
        (utilisateur_id, jeton_hash, expire_le),
    )
    db.commit()
    return jeton


def trouver_reset_valide(jeton, db):
    """Retrouve la demande de réinitialisation correspondant à ce jeton (reçu en clair
    dans l'URL). Renvoie None si le jeton est inconnu, déjà utilisé ou expiré."""
    jeton_hash = hashlib.sha256(jeton.encode("utf-8")).hexdigest()
    ligne = db.execute(
        "SELECT reinitialisations_mot_de_passe.id AS reset_id, "
        "reinitialisations_mot_de_passe.expire_le, "
        "utilisateurs.id AS utilisateur_id, utilisateurs.nom_utilisateur "
        "FROM reinitialisations_mot_de_passe "
        "JOIN utilisateurs ON utilisateurs.id = reinitialisations_mot_de_passe.utilisateur_id "
        "WHERE reinitialisations_mot_de_passe.jeton_hash = ? "
        "AND reinitialisations_mot_de_passe.utilise = 0",
        (jeton_hash,),
    ).fetchone()

    if ligne is None:
        return None
    if datetime.fromisoformat(ligne["expire_le"]) < datetime.utcnow():
        return None
    return ligne


def envoyer_email_reinitialisation(email, nom_utilisateur, lien):
    """Envoie le lien de réinitialisation par e-mail si email_config.json est rempli.

    Sinon (cas par défaut), affiche simplement le lien dans la console du serveur :
    ça permet de tester tout le parcours "mot de passe oublié" sans avoir à
    configurer un vrai compte e-mail (voir email_config.example.json).
    """
    if not CONFIG_EMAIL.get("serveur") or not CONFIG_EMAIL.get("adresse") or not CONFIG_EMAIL.get("mot_de_passe"):
        print(
            f"[PromptHub] Aucun e-mail configuré (voir email_config.example.json). "
            f"Lien de réinitialisation pour {nom_utilisateur} <{email}> : {lien}"
        )
        return

    message = EmailMessage()
    message["Subject"] = "Réinitialise ton mot de passe PromptHub"
    message["From"] = CONFIG_EMAIL["adresse"]
    message["To"] = email
    message.set_content(
        f"Bonjour {nom_utilisateur},\n\n"
        "Quelqu'un (probablement toi) a demandé à réinitialiser le mot de passe de ton "
        "compte PromptHub. Clique sur ce lien pour choisir un nouveau mot de passe "
        f"(valable 30 minutes) :\n\n{lien}\n\n"
        "Si tu n'es pas à l'origine de cette demande, tu peux ignorer cet e-mail : "
        "ton mot de passe actuel reste inchangé."
    )

    with smtplib.SMTP_SSL(CONFIG_EMAIL["serveur"], CONFIG_EMAIL.get("port", 465)) as serveur:
        serveur.login(CONFIG_EMAIL["adresse"], CONFIG_EMAIL["mot_de_passe"])
        serveur.send_message(message)


# ---------- Vérification de l'e-mail (inscription) ----------
DUREE_CODE_VERIFICATION = timedelta(minutes=30)


def generer_code_verification(utilisateur_id, db):
    """Crée un code de vérification à 6 chiffres, valable 30 minutes.

    Même principe que generer_jeton_reset : seul le hash du code part en base, le
    code en clair n'existe que dans l'e-mail envoyé (ou affiché, voir
    envoyer_email_verification).
    """
    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    expire_le = (datetime.utcnow() + DUREE_CODE_VERIFICATION).isoformat()
    db.execute(
        "INSERT INTO verifications_email (utilisateur_id, code_hash, expire_le) VALUES (?, ?, ?)",
        (utilisateur_id, code_hash, expire_le),
    )
    db.commit()
    return code


def trouver_verification_valide(utilisateur_id, code, db):
    """Retrouve la demande de vérification correspondant à ce code (reçu en clair,
    tapé par l'utilisateur). Renvoie None si inconnu, déjà utilisé ou expiré."""
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    ligne = db.execute(
        "SELECT id, expire_le FROM verifications_email "
        "WHERE utilisateur_id = ? AND code_hash = ? AND utilise = 0",
        (utilisateur_id, code_hash),
    ).fetchone()

    if ligne is None:
        return None
    if datetime.fromisoformat(ligne["expire_le"]) < datetime.utcnow():
        return None
    return ligne


def envoyer_email_verification(email, prenom, code):
    """Envoie le code de vérification par e-mail si email_config.json est rempli.

    Sinon (cas par défaut), affiche simplement le code dans la console du serveur :
    ça permet de tester tout le parcours d'inscription sans avoir à configurer un
    vrai compte e-mail (voir email_config.example.json).
    """
    if not CONFIG_EMAIL.get("serveur") or not CONFIG_EMAIL.get("adresse") or not CONFIG_EMAIL.get("mot_de_passe"):
        print(
            f"[PromptHub] Aucun e-mail configuré (voir email_config.example.json). "
            f"Code de vérification pour {prenom} <{email}> : {code}"
        )
        return

    message = EmailMessage()
    message["Subject"] = "Confirme ton adresse e-mail PromptHub"
    message["From"] = CONFIG_EMAIL["adresse"]
    message["To"] = email
    message.set_content(
        f"Bonjour {prenom},\n\n"
        "Voici ton code de confirmation pour terminer ton inscription sur PromptHub "
        f"(valable 30 minutes) :\n\n{code}\n\n"
        "Si tu n'es pas à l'origine de cette inscription, tu peux ignorer cet e-mail."
    )

    with smtplib.SMTP_SSL(CONFIG_EMAIL["serveur"], CONFIG_EMAIL.get("port", 465)) as serveur:
        serveur.login(CONFIG_EMAIL["adresse"], CONFIG_EMAIL["mot_de_passe"])
        serveur.send_message(message)


# ---------- Prompts : tags ----------
def nettoyer_tags(brut):
    """Prend la liste de tags envoyée par le client et en renvoie jusqu'à 8, nettoyés,
    en minuscules et sans doublon (voir la table tags dans schema.sql)."""
    if not isinstance(brut, list):
        return []

    tags = []
    for valeur in brut:
        tag = nettoyer(valeur).lower()
        if 2 <= len(tag) <= 30 and tag not in tags:
            tags.append(tag)
        if len(tags) == 8:
            break
    return tags


def enregistrer_tags(prompt_id, tags, db):
    """Relie prompt_id à chaque tag de la liste (les crée s'ils n'existent pas encore),
    après avoir retiré les anciens liens : sert aussi bien à la création qu'à la
    modification d'un prompt (voir creer_prompt/modifier_prompt)."""
    db.execute("DELETE FROM prompts_tags WHERE prompt_id = ?", (prompt_id,))
    for tag in tags:
        ligne = db.execute("SELECT id FROM tags WHERE nom = ?", (tag,)).fetchone()
        if ligne is None:
            curseur = db.execute("INSERT INTO tags (nom) VALUES (?)", (tag,))
            tag_id = curseur.lastrowid
        else:
            tag_id = ligne["id"]
        db.execute(
            "INSERT OR IGNORE INTO prompts_tags (prompt_id, tag_id) VALUES (?, ?)",
            (prompt_id, tag_id),
        )
    db.commit()


def tags_du_prompt(prompt_id, db):
    lignes = db.execute(
        "SELECT tags.nom FROM tags "
        "JOIN prompts_tags ON prompts_tags.tag_id = tags.id "
        "WHERE prompts_tags.prompt_id = ? ORDER BY tags.nom",
        (prompt_id,),
    ).fetchall()
    return [ligne["nom"] for ligne in lignes]


# ---------- Prompts : mise en forme pour l'API ----------
def prompt_en_dict(ligne, db, utilisateur_id, est_admin):
    """Construit le dictionnaire complet d'un prompt pour la bibliothèque : tags,
    favoris, note moyenne, nombre de commentaires, et les droits de l'utilisateur
    connecté sur ce prompt précis (favori/note déjà posés, modification autorisée)."""
    prompt_id = ligne["id"]

    favoris_ligne = db.execute(
        "SELECT COUNT(*) AS nombre, "
        "SUM(CASE WHEN utilisateur_id = ? THEN 1 ELSE 0 END) AS le_mien "
        "FROM favoris WHERE prompt_id = ?",
        (utilisateur_id, prompt_id),
    ).fetchone()

    notes_ligne = db.execute(
        "SELECT COUNT(*) AS nombre, AVG(etoiles) AS moyenne FROM notes WHERE prompt_id = ?",
        (prompt_id,),
    ).fetchone()

    ma_note_ligne = db.execute(
        "SELECT etoiles FROM notes WHERE prompt_id = ? AND utilisateur_id = ?",
        (prompt_id, utilisateur_id),
    ).fetchone()

    nombre_commentaires = db.execute(
        "SELECT COUNT(*) AS nombre FROM commentaires WHERE prompt_id = ?", (prompt_id,)
    ).fetchone()["nombre"]

    return {
        "id": prompt_id,
        "titre": ligne["titre"],
        "contenu": ligne["contenu"],
        "categorie": ligne["categorie"],
        "tags": tags_du_prompt(prompt_id, db),
        "auteur": ligne["auteur"],
        "auteur_id": ligne["auteur_id"],
        "nombre_favoris": favoris_ligne["nombre"],
        "est_favori": bool(favoris_ligne["le_mien"]),
        "moyenne_etoiles": round(notes_ligne["moyenne"], 1) if notes_ligne["moyenne"] is not None else None,
        "nombre_notes": notes_ligne["nombre"],
        "ma_note": ma_note_ligne["etoiles"] if ma_note_ligne else None,
        "nombre_commentaires": nombre_commentaires,
        "est_auteur": ligne["auteur_id"] == utilisateur_id,
        "peut_modifier": ligne["auteur_id"] == utilisateur_id or est_admin,
    }


REQUETE_PROMPT_DE_BASE = (
    "SELECT prompts.id, prompts.titre, prompts.contenu, prompts.categorie, prompts.auteur_id, "
    "COALESCE(utilisateurs.nom_utilisateur, 'PromptHub') AS auteur "
    "FROM prompts LEFT JOIN utilisateurs ON utilisateurs.id = prompts.auteur_id "
)


def commentaire_en_dict(ligne, utilisateur_id, est_admin, db):
    votes = db.execute(
        "SELECT COALESCE(SUM(CASE WHEN valeur = 1 THEN 1 ELSE 0 END), 0) AS pour, "
        "COALESCE(SUM(CASE WHEN valeur = -1 THEN 1 ELSE 0 END), 0) AS contre "
        "FROM votes_commentaires WHERE commentaire_id = ?",
        (ligne["id"],),
    ).fetchone()
    mon_vote_ligne = db.execute(
        "SELECT valeur FROM votes_commentaires WHERE commentaire_id = ? AND utilisateur_id = ?",
        (ligne["id"], utilisateur_id),
    ).fetchone()

    return {
        "id": ligne["id"],
        "contenu": ligne["contenu"],
        "auteur": ligne["auteur"],
        "auteur_id": ligne["auteur_id"],
        "cree_le": ligne["cree_le"],
        "pour": votes["pour"],
        "contre": votes["contre"],
        "mon_vote": mon_vote_ligne["valeur"] if mon_vote_ligne else 0,
        "peut_supprimer": ligne["auteur_id"] == utilisateur_id or est_admin,
    }


def connexion_requise(vue):
    """Décorateur : bloque une route si personne n'est connecté."""

    @wraps(vue)
    def route_protegee(*args, **kwargs):
        if "utilisateur_id" not in session:
            return jsonify({"erreur": "Connecte-toi pour continuer."}), 401
        return vue(*args, **kwargs)

    return route_protegee


# ---------- Pages ----------
@app.get("/")
def accueil():
    return render_template("index.html")


@app.get("/bibliotheque")
def page_bibliotheque():
    """La bibliothèque complète (recherche, filtres, favoris, notes, commentaires,
    mes prompts...) est réservée aux membres connectés ; l'accueil n'en garde qu'un
    aperçu public (voir apercu_prompts)."""
    if "utilisateur_id" not in session:
        return redirect(url_for("page_connexion"))
    return render_template("bibliotheque.html", categories=CATEGORIES)


@app.get("/connexion")
def page_connexion():
    fournisseurs = [dict(f, actif=f["id"] in FOURNISSEURS_ACTIFS) for f in FOURNISSEURS_AFFICHAGE]
    return render_template("connexion.html", fournisseurs=fournisseurs)


@app.get("/connexion/<fournisseur>")
def connexion_sociale(fournisseur):
    """Lance la connexion via un réseau social (redirige vers Google, GitHub...)."""
    if fournisseur not in FOURNISSEURS_ACTIFS:
        return redirect(url_for("page_connexion"))

    client = oauth.create_client(fournisseur)
    destination = url_for("retour_connexion_sociale", fournisseur=fournisseur, _external=True)
    return client.authorize_redirect(destination)


@app.get("/connexion/<fournisseur>/retour")
def retour_connexion_sociale(fournisseur):
    """Reçoit la réponse du réseau social, puis connecte ou crée le compte."""
    if fournisseur not in FOURNISSEURS_ACTIFS:
        return redirect(url_for("page_connexion"))

    client = oauth.create_client(fournisseur)
    try:
        jeton = client.authorize_access_token()
        identifiant_externe, nom_affiche = extraire_profil(fournisseur, client, jeton)
    except Exception:
        # Le visiteur a peut-être refusé l'accès, ou le réseau social a renvoyé une
        # erreur : dans tous les cas, on revient simplement à la page de connexion.
        identifiant_externe, nom_affiche = None, ""

    if not identifiant_externe:
        return redirect(url_for("page_connexion"))

    db = get_db()
    ligne = db.execute(
        "SELECT id, nom_utilisateur, est_admin FROM utilisateurs WHERE fournisseur = ? AND identifiant_externe = ?",
        (fournisseur, identifiant_externe),
    ).fetchone()

    if ligne is None:
        nom = nom_utilisateur_unique(nom_utilisateur_depuis_profil(nom_affiche), db)
        curseur = db.execute(
            "INSERT INTO utilisateurs (nom_utilisateur, fournisseur, identifiant_externe) VALUES (?, ?, ?)",
            (nom, fournisseur, identifiant_externe),
        )
        db.commit()
        session["utilisateur_id"] = curseur.lastrowid
        session["nom_utilisateur"] = nom
        session["est_admin"] = False
    else:
        session["utilisateur_id"] = ligne["id"]
        session["nom_utilisateur"] = ligne["nom_utilisateur"]
        session["est_admin"] = bool(ligne["est_admin"])

    return redirect(url_for("accueil"))


# ---------- API : prompts (bibliothèque, réservée aux connectés) ----------
@app.get("/api/prompts")
@connexion_requise
def lister_prompts():
    recherche = request.args.get("q", "").strip()
    categorie = request.args.get("categorie", "").strip()
    tag = request.args.get("tag", "").strip().lower()
    mes_prompts = request.args.get("mes_prompts") == "1"
    favoris_seulement = request.args.get("favoris") == "1"

    requete = REQUETE_PROMPT_DE_BASE + "WHERE 1 = 1"
    parametres = []

    if recherche:
        requete += " AND (prompts.titre LIKE ? OR prompts.contenu LIKE ?)"
        parametres.extend([f"%{recherche}%", f"%{recherche}%"])
    if categorie:
        requete += " AND prompts.categorie = ?"
        parametres.append(categorie)
    if tag:
        requete += (
            " AND prompts.id IN ("
            "SELECT prompts_tags.prompt_id FROM prompts_tags "
            "JOIN tags ON tags.id = prompts_tags.tag_id WHERE tags.nom = ?)"
        )
        parametres.append(tag)
    if mes_prompts:
        requete += " AND prompts.auteur_id = ?"
        parametres.append(session["utilisateur_id"])
    if favoris_seulement:
        requete += " AND prompts.id IN (SELECT prompt_id FROM favoris WHERE utilisateur_id = ?)"
        parametres.append(session["utilisateur_id"])

    requete += " ORDER BY prompts.id DESC"

    db = get_db()
    lignes = db.execute(requete, parametres).fetchall()
    est_admin = bool(session.get("est_admin"))
    return jsonify(
        [prompt_en_dict(ligne, db, session["utilisateur_id"], est_admin) for ligne in lignes]
    )


@app.get("/api/prompts/apercu")
def apercu_prompts():
    """Un aperçu public de la bibliothèque pour la page d'accueil (pas besoin d'être
    connecté) : quelques prompts au hasard, sans détail de favoris/notes/commentaires
    (ça, c'est réservé à la bibliothèque complète, voir lister_prompts ci-dessus)."""
    lignes = get_db().execute(
        "SELECT prompts.titre, prompts.contenu, prompts.categorie, "
        "COALESCE(utilisateurs.nom_utilisateur, 'PromptHub') AS auteur "
        "FROM prompts LEFT JOIN utilisateurs ON utilisateurs.id = prompts.auteur_id "
        "ORDER BY RANDOM() LIMIT 9"
    ).fetchall()
    return jsonify([dict(ligne) for ligne in lignes])


@app.get("/api/tags")
@connexion_requise
def lister_tags():
    lignes = get_db().execute("SELECT nom FROM tags ORDER BY nom").fetchall()
    return jsonify([ligne["nom"] for ligne in lignes])


def valider_champs_prompt(donnees):
    """Valide titre/contenu/catégorie communs à la création et à la modification.
    Renvoie (titre, contenu, categorie, tags, erreur). erreur est None si tout va bien."""
    titre = nettoyer(donnees.get("titre"))
    contenu = nettoyer(donnees.get("contenu"))
    categorie = nettoyer(donnees.get("categorie"))
    tags = nettoyer_tags(donnees.get("tags"))

    if not 3 <= len(titre) <= 60:
        return None, None, None, None, "Le titre doit faire entre 3 et 60 caractères."
    if not 10 <= len(contenu) <= 500:
        return None, None, None, None, "Le prompt doit faire entre 10 et 500 caractères."
    if categorie not in CATEGORIES:
        return None, None, None, None, "Catégorie inconnue."
    return titre, contenu, categorie, tags, None


@app.post("/api/prompts")
@connexion_requise
def creer_prompt():
    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400

    titre, contenu, categorie, tags, erreur = valider_champs_prompt(donnees)
    if erreur:
        return jsonify({"erreur": erreur}), 400

    db = get_db()
    try:
        curseur = db.execute(
            "INSERT INTO prompts (titre, contenu, categorie, auteur_id) VALUES (?, ?, ?, ?)",
            (titre, contenu, categorie, session["utilisateur_id"]),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"erreur": "Un prompt avec ce titre existe déjà."}), 409

    enregistrer_tags(curseur.lastrowid, tags, db)

    ligne = db.execute(REQUETE_PROMPT_DE_BASE + "WHERE prompts.id = ?", (curseur.lastrowid,)).fetchone()
    est_admin = bool(session.get("est_admin"))
    return jsonify(prompt_en_dict(ligne, db, session["utilisateur_id"], est_admin)), 201


@app.put("/api/prompts/<int:prompt_id>")
@connexion_requise
def modifier_prompt(prompt_id):
    db = get_db()
    existant = db.execute("SELECT auteur_id FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
    if existant is None:
        return jsonify({"erreur": "Prompt introuvable."}), 404
    if existant["auteur_id"] != session["utilisateur_id"] and not session.get("est_admin"):
        return jsonify({"erreur": "Tu ne peux modifier que tes propres prompts."}), 403

    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400

    titre, contenu, categorie, tags, erreur = valider_champs_prompt(donnees)
    if erreur:
        return jsonify({"erreur": erreur}), 400

    try:
        db.execute(
            "UPDATE prompts SET titre = ?, contenu = ?, categorie = ? WHERE id = ?",
            (titre, contenu, categorie, prompt_id),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"erreur": "Un prompt avec ce titre existe déjà."}), 409

    enregistrer_tags(prompt_id, tags, db)

    ligne = db.execute(REQUETE_PROMPT_DE_BASE + "WHERE prompts.id = ?", (prompt_id,)).fetchone()
    est_admin = bool(session.get("est_admin"))
    return jsonify(prompt_en_dict(ligne, db, session["utilisateur_id"], est_admin))


@app.delete("/api/prompts/<int:prompt_id>")
@connexion_requise
def supprimer_prompt(prompt_id):
    db = get_db()
    existant = db.execute("SELECT auteur_id FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
    if existant is None:
        return jsonify({"erreur": "Prompt introuvable."}), 404
    if existant["auteur_id"] != session["utilisateur_id"] and not session.get("est_admin"):
        return jsonify({"erreur": "Tu ne peux supprimer que tes propres prompts."}), 403

    # Les commentaires du prompt disparaissent avec lui : on retire d'abord leurs
    # votes (ils référencent commentaires), sinon ils resteraient orphelins.
    db.execute(
        "DELETE FROM votes_commentaires WHERE commentaire_id IN "
        "(SELECT id FROM commentaires WHERE prompt_id = ?)",
        (prompt_id,),
    )
    db.execute("DELETE FROM commentaires WHERE prompt_id = ?", (prompt_id,))
    db.execute("DELETE FROM favoris WHERE prompt_id = ?", (prompt_id,))
    db.execute("DELETE FROM notes WHERE prompt_id = ?", (prompt_id,))
    db.execute("DELETE FROM prompts_tags WHERE prompt_id = ?", (prompt_id,))
    db.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
    db.commit()
    return jsonify({"ok": True})


@app.post("/api/prompts/<int:prompt_id>/favori")
@connexion_requise
def basculer_favori(prompt_id):
    db = get_db()
    if db.execute("SELECT 1 FROM prompts WHERE id = ?", (prompt_id,)).fetchone() is None:
        return jsonify({"erreur": "Prompt introuvable."}), 404

    existe = db.execute(
        "SELECT 1 FROM favoris WHERE utilisateur_id = ? AND prompt_id = ?",
        (session["utilisateur_id"], prompt_id),
    ).fetchone()

    if existe is None:
        db.execute(
            "INSERT INTO favoris (utilisateur_id, prompt_id) VALUES (?, ?)",
            (session["utilisateur_id"], prompt_id),
        )
        est_favori = True
    else:
        db.execute(
            "DELETE FROM favoris WHERE utilisateur_id = ? AND prompt_id = ?",
            (session["utilisateur_id"], prompt_id),
        )
        est_favori = False
    db.commit()

    nombre = db.execute(
        "SELECT COUNT(*) AS n FROM favoris WHERE prompt_id = ?", (prompt_id,)
    ).fetchone()["n"]
    return jsonify({"est_favori": est_favori, "nombre_favoris": nombre})


@app.post("/api/prompts/<int:prompt_id>/note")
@connexion_requise
def noter_prompt(prompt_id):
    db = get_db()
    if db.execute("SELECT 1 FROM prompts WHERE id = ?", (prompt_id,)).fetchone() is None:
        return jsonify({"erreur": "Prompt introuvable."}), 404

    donnees = request.get_json(silent=True)
    etoiles = donnees.get("etoiles") if isinstance(donnees, dict) else None
    if not isinstance(etoiles, int) or isinstance(etoiles, bool) or not 1 <= etoiles <= 5:
        return jsonify({"erreur": "La note doit être un nombre entier de 1 à 5."}), 400

    db.execute(
        "INSERT INTO notes (utilisateur_id, prompt_id, etoiles) VALUES (?, ?, ?) "
        "ON CONFLICT(utilisateur_id, prompt_id) DO UPDATE SET etoiles = excluded.etoiles",
        (session["utilisateur_id"], prompt_id, etoiles),
    )
    db.commit()

    resultat = db.execute(
        "SELECT COUNT(*) AS nombre, AVG(etoiles) AS moyenne FROM notes WHERE prompt_id = ?",
        (prompt_id,),
    ).fetchone()
    return jsonify(
        {
            "ma_note": etoiles,
            "nombre_notes": resultat["nombre"],
            "moyenne_etoiles": round(resultat["moyenne"], 1),
        }
    )


# ---------- API : commentaires ----------
@app.get("/api/prompts/<int:prompt_id>/commentaires")
@connexion_requise
def lister_commentaires(prompt_id):
    db = get_db()
    lignes = db.execute(
        "SELECT commentaires.id, commentaires.contenu, commentaires.cree_le, "
        "commentaires.utilisateur_id AS auteur_id, "
        "COALESCE(utilisateurs.nom_utilisateur, 'PromptHub') AS auteur "
        "FROM commentaires LEFT JOIN utilisateurs ON utilisateurs.id = commentaires.utilisateur_id "
        "WHERE commentaires.prompt_id = ? ORDER BY commentaires.id ASC",
        (prompt_id,),
    ).fetchall()
    est_admin = bool(session.get("est_admin"))
    return jsonify(
        [commentaire_en_dict(ligne, session["utilisateur_id"], est_admin, db) for ligne in lignes]
    )


@app.post("/api/prompts/<int:prompt_id>/commentaires")
@connexion_requise
def ajouter_commentaire(prompt_id):
    db = get_db()
    if db.execute("SELECT 1 FROM prompts WHERE id = ?", (prompt_id,)).fetchone() is None:
        return jsonify({"erreur": "Prompt introuvable."}), 404

    donnees = request.get_json(silent=True)
    contenu = nettoyer(donnees.get("contenu")) if isinstance(donnees, dict) else ""
    if not 1 <= len(contenu) <= 500:
        return jsonify({"erreur": "Le commentaire doit faire entre 1 et 500 caractères."}), 400

    curseur = db.execute(
        "INSERT INTO commentaires (prompt_id, utilisateur_id, contenu) VALUES (?, ?, ?)",
        (prompt_id, session["utilisateur_id"], contenu),
    )
    db.commit()

    ligne = db.execute(
        "SELECT commentaires.id, commentaires.contenu, commentaires.cree_le, "
        "commentaires.utilisateur_id AS auteur_id, "
        "COALESCE(utilisateurs.nom_utilisateur, 'PromptHub') AS auteur "
        "FROM commentaires LEFT JOIN utilisateurs ON utilisateurs.id = commentaires.utilisateur_id "
        "WHERE commentaires.id = ?",
        (curseur.lastrowid,),
    ).fetchone()
    est_admin = bool(session.get("est_admin"))
    return jsonify(commentaire_en_dict(ligne, session["utilisateur_id"], est_admin, db)), 201


@app.delete("/api/commentaires/<int:commentaire_id>")
@connexion_requise
def supprimer_commentaire(commentaire_id):
    db = get_db()
    ligne = db.execute(
        "SELECT utilisateur_id FROM commentaires WHERE id = ?", (commentaire_id,)
    ).fetchone()
    if ligne is None:
        return jsonify({"erreur": "Commentaire introuvable."}), 404
    if ligne["utilisateur_id"] != session["utilisateur_id"] and not session.get("est_admin"):
        return jsonify({"erreur": "Tu ne peux supprimer que tes propres commentaires."}), 403

    db.execute("DELETE FROM votes_commentaires WHERE commentaire_id = ?", (commentaire_id,))
    db.execute("DELETE FROM commentaires WHERE id = ?", (commentaire_id,))
    db.commit()
    return jsonify({"ok": True})


@app.post("/api/commentaires/<int:commentaire_id>/vote")
@connexion_requise
def voter_commentaire(commentaire_id):
    db = get_db()
    if db.execute("SELECT 1 FROM commentaires WHERE id = ?", (commentaire_id,)).fetchone() is None:
        return jsonify({"erreur": "Commentaire introuvable."}), 404

    donnees = request.get_json(silent=True)
    valeur = donnees.get("valeur") if isinstance(donnees, dict) else None
    if valeur not in (1, -1):
        return jsonify({"erreur": "Valeur de vote invalide."}), 400

    existant = db.execute(
        "SELECT valeur FROM votes_commentaires WHERE commentaire_id = ? AND utilisateur_id = ?",
        (commentaire_id, session["utilisateur_id"]),
    ).fetchone()

    if existant is None:
        db.execute(
            "INSERT INTO votes_commentaires (commentaire_id, utilisateur_id, valeur) VALUES (?, ?, ?)",
            (commentaire_id, session["utilisateur_id"], valeur),
        )
        mon_vote = valeur
    elif existant["valeur"] == valeur:
        db.execute(
            "DELETE FROM votes_commentaires WHERE commentaire_id = ? AND utilisateur_id = ?",
            (commentaire_id, session["utilisateur_id"]),
        )
        mon_vote = 0
    else:
        db.execute(
            "UPDATE votes_commentaires SET valeur = ? WHERE commentaire_id = ? AND utilisateur_id = ?",
            (valeur, commentaire_id, session["utilisateur_id"]),
        )
        mon_vote = valeur
    db.commit()

    votes = db.execute(
        "SELECT COALESCE(SUM(CASE WHEN valeur = 1 THEN 1 ELSE 0 END), 0) AS pour, "
        "COALESCE(SUM(CASE WHEN valeur = -1 THEN 1 ELSE 0 END), 0) AS contre "
        "FROM votes_commentaires WHERE commentaire_id = ?",
        (commentaire_id,),
    ).fetchone()
    return jsonify({"pour": votes["pour"], "contre": votes["contre"], "mon_vote": mon_vote})


# ---------- API : comptes ----------
@app.post("/api/inscription")
def inscription():
    """Crée le compte (pseudo généré automatiquement, voir pseudo_depuis_identite),
    ouvre la session, puis envoie le code de vérification de l'e-mail. L'inscription
    n'est "complète" qu'une fois ce code confirmé (voir verifier_email ci-dessous) :
    tant que ce n'est pas fait, email_verifie reste à 0 (valeur par défaut, voir
    schema.sql), mais le compte existe déjà et la session est ouverte.
    """
    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400

    nom = nettoyer(donnees.get("nom"))
    prenom = nettoyer(donnees.get("prenom"))
    email = nettoyer(donnees.get("email")).lower()
    mot_de_passe = texte_ou_vide(donnees.get("mot_de_passe"))

    if not nom_propre_valide(nom):
        return jsonify({"erreur": "Le nom doit faire 2 à 50 caractères, sans chiffre."}), 400
    if not nom_propre_valide(prenom):
        return jsonify({"erreur": "Le prénom doit faire 2 à 50 caractères, sans chiffre."}), 400
    if not email_valide(email):
        return jsonify({"erreur": "Adresse e-mail invalide."}), 400
    if not mot_de_passe_valide(mot_de_passe):
        return jsonify(
            {"erreur": "Le mot de passe doit faire au moins 8 caractères, avec une majuscule, un chiffre et un symbole."}
        ), 400

    db = get_db()
    if db.execute("SELECT 1 FROM utilisateurs WHERE email = ?", (email,)).fetchone() is not None:
        return jsonify({"erreur": "Un compte existe déjà avec cet e-mail."}), 409

    pseudo = pseudo_depuis_identite(nom, prenom, db)
    try:
        curseur = db.execute(
            "INSERT INTO utilisateurs (nom_utilisateur, nom, prenom, email, mot_de_passe_hash) "
            "VALUES (?, ?, ?, ?, ?)",
            (pseudo, nom, prenom, email, generate_password_hash(mot_de_passe)),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"erreur": "Un compte existe déjà avec cet e-mail."}), 409

    session["utilisateur_id"] = curseur.lastrowid
    session["nom_utilisateur"] = pseudo
    promouvoir_si_admin(curseur.lastrowid, email, db)
    session["est_admin"] = bool(
        db.execute("SELECT est_admin FROM utilisateurs WHERE id = ?", (curseur.lastrowid,)).fetchone()["est_admin"]
    )

    code = generer_code_verification(curseur.lastrowid, db)
    envoyer_email_verification(email, prenom, code)

    return jsonify({"nom_utilisateur": pseudo, "email_verifie": False}), 201


@app.post("/api/verifier-email")
@connexion_requise
def verifier_email():
    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400

    code = nettoyer(donnees.get("code"))
    db = get_db()
    ligne = trouver_verification_valide(session["utilisateur_id"], code, db)
    if ligne is None:
        return jsonify({"erreur": "Code invalide ou expiré."}), 400

    db.execute("UPDATE utilisateurs SET email_verifie = 1 WHERE id = ?", (session["utilisateur_id"],))
    db.execute("UPDATE verifications_email SET utilise = 1 WHERE id = ?", (ligne["id"],))
    db.commit()

    return jsonify({"ok": True})


@app.post("/api/renvoyer-code-verification")
@connexion_requise
def renvoyer_code_verification():
    db = get_db()
    ligne = db.execute(
        "SELECT email, prenom FROM utilisateurs WHERE id = ?", (session["utilisateur_id"],)
    ).fetchone()
    if ligne is None or not ligne["email"]:
        return jsonify({"erreur": "Aucun e-mail associé à ce compte."}), 400

    code = generer_code_verification(session["utilisateur_id"], db)
    envoyer_email_verification(ligne["email"], ligne["prenom"] or ligne["email"], code)
    return jsonify({"message": "Un nouveau code vient d'être envoyé."})


@app.post("/api/connexion")
def connexion():
    """Le pseudo ET l'e-mail peuvent servir à se connecter (voir le champ "identifiant",
    affiché comme "Pseudo ou e-mail" dans connexion.html)."""
    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400

    identifiant = nettoyer(donnees.get("identifiant"))
    mot_de_passe = texte_ou_vide(donnees.get("mot_de_passe"))

    db = get_db()
    ligne = db.execute(
        "SELECT id, nom_utilisateur, mot_de_passe_hash, email, est_admin FROM utilisateurs "
        "WHERE nom_utilisateur = ? OR email = ?",
        (identifiant, identifiant.lower()),
    ).fetchone()

    # ligne["mot_de_passe_hash"] est vide pour un compte créé uniquement via un
    # réseau social (voir retour_connexion_sociale) : pas de mot de passe à vérifier.
    if (
        ligne is None
        or ligne["mot_de_passe_hash"] is None
        or not check_password_hash(ligne["mot_de_passe_hash"], mot_de_passe)
    ):
        return jsonify({"erreur": "Pseudo, e-mail ou mot de passe incorrect."}), 401

    session["utilisateur_id"] = ligne["id"]
    session["nom_utilisateur"] = ligne["nom_utilisateur"]
    promouvoir_si_admin(ligne["id"], ligne["email"], db)
    session["est_admin"] = bool(ligne["est_admin"]) or (bool(ligne["email"]) and ligne["email"].lower() in EMAILS_ADMIN)
    return jsonify({"nom_utilisateur": ligne["nom_utilisateur"], "est_admin": session["est_admin"]})


@app.post("/api/mot-de-passe-oublie")
def demander_reinitialisation():
    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400

    email = nettoyer(donnees.get("email")).lower()

    # Toujours le même message, que l'e-mail corresponde à un compte ou non : sinon,
    # quelqu'un pourrait s'en servir pour deviner quels e-mails sont inscrits.
    reponse = {"message": "Si un compte existe avec cet e-mail, un lien de réinitialisation vient d'être envoyé."}
    if not email_valide(email):
        return jsonify(reponse)

    db = get_db()
    ligne = db.execute(
        "SELECT id, nom_utilisateur FROM utilisateurs WHERE email = ? AND mot_de_passe_hash IS NOT NULL",
        (email,),
    ).fetchone()

    if ligne is not None:
        jeton = generer_jeton_reset(ligne["id"], db)
        lien = url_for("page_reinitialisation", jeton=jeton, _external=True)
        envoyer_email_reinitialisation(email, ligne["nom_utilisateur"], lien)

    return jsonify(reponse)


@app.get("/reinitialiser/<jeton>")
def page_reinitialisation(jeton):
    valide = trouver_reset_valide(jeton, get_db()) is not None
    return render_template("reinitialiser.html", jeton=jeton, valide=valide)


@app.post("/api/reinitialiser")
def reinitialiser_mot_de_passe():
    donnees = request.get_json(silent=True)
    if not isinstance(donnees, dict):
        return jsonify({"erreur": "Données invalides."}), 400

    jeton = nettoyer(donnees.get("jeton"))
    mot_de_passe = texte_ou_vide(donnees.get("mot_de_passe"))

    db = get_db()
    ligne = trouver_reset_valide(jeton, db)
    if ligne is None:
        return jsonify({"erreur": "Ce lien n'est plus valable. Refais une demande de réinitialisation."}), 400
    if not mot_de_passe_valide(mot_de_passe):
        return jsonify(
            {"erreur": "Le mot de passe doit faire au moins 8 caractères, avec une majuscule, un chiffre et un symbole."}
        ), 400

    db.execute(
        "UPDATE utilisateurs SET mot_de_passe_hash = ? WHERE id = ?",
        (generate_password_hash(mot_de_passe), ligne["utilisateur_id"]),
    )
    db.execute("UPDATE reinitialisations_mot_de_passe SET utilise = 1 WHERE id = ?", (ligne["reset_id"],))
    db.commit()

    return jsonify({"nom_utilisateur": ligne["nom_utilisateur"]})


@app.post("/api/deconnexion")
def deconnexion():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/session")
def info_session():
    if "utilisateur_id" in session:
        return jsonify(
            {
                "id": session["utilisateur_id"],
                "nom_utilisateur": session["nom_utilisateur"],
                "est_admin": bool(session.get("est_admin")),
            }
        )
    return jsonify({"id": None, "nom_utilisateur": None, "est_admin": False})


@app.get("/api/stats")
def statistiques():
    db = get_db()
    totaux = db.execute(
        "SELECT COUNT(*) AS total, (SELECT COUNT(*) FROM favoris) AS likes FROM prompts"
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
    