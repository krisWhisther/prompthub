"use strict";

/* ============================================================
PromptHub - script.js
1. Constantes   2. Éléments de la page   3. Thème clair/sombre
4. Appels au serveur   5. Affichage   6. Actions   7. Démarrage
============================================================ */

// ---------- 1. Constantes ----------
const URL_PROMPTS = "/api/prompts";
const URL_STATS = "/api/stats";
const URL_IDEE_JAVA = "http://127.0.0.1:8081/api/idee";
const CLE_THEME = "prompthub-theme";

// ---------- 2. Éléments de la page ----------
const boutonTheme = document.getElementById("bouton-theme");
const champRecherche = document.getElementById("recherche");
const filtreCategorie = document.getElementById("filtre-categorie");
const messageListe = document.getElementById("message-liste");
const grille = document.getElementById("grille-prompts");
const formulaire = document.getElementById("formulaire-prompt");
const messageFormulaire = document.getElementById("message-formulaire");
const boutonIdee = document.getElementById("bouton-idee");
const texteIdee = document.getElementById("texte-idee");
const statTotal = document.getElementById("stat-total");
const statTop = document.getElementById("stat-top");
const statLikes = document.getElementById("stat-likes");

// ---------- 3. Thème clair / sombre ----------
function lireThemeSauvegarde() {
    try {
        return localStorage.getItem(CLE_THEME);
    } catch (erreur) {
        return null;
    }
}

function sauvegarderTheme(theme) {
    try {
        localStorage.setItem(CLE_THEME, theme);
    } catch (erreur) {
        // Si le navigateur refuse, ce n'est pas grave : le thème ne sera pas retenu.
    }
}

function appliquerTheme(theme) {
    document.documentElement.dataset.theme = theme;
    boutonTheme.textContent = theme === "dark" ? "Mode clair" : "Mode sombre";
}

boutonTheme.addEventListener("click", () => {
    const nouveauTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    appliquerTheme(nouveauTheme);
    sauvegarderTheme(nouveauTheme);
});

// ---------- 4. Appels au serveur ----------
// Envoie une requête et renvoie les données JSON.
// Si le serveur répond par une erreur, on lance une Error avec son message.
async function appelerApi(url, options) {
    const reponse = await fetch(url, options);

    let donnees = null;
    try {
        donnees = await reponse.json();
    } catch (erreur) {
        donnees = null;
    }

    if (!reponse.ok) {
        const message = donnees && donnees.erreur ? donnees.erreur : "Erreur " + reponse.status;
        throw new Error(message);
    }
    return donnees;
}

// ---------- 5. Affichage ----------
function afficherMessage(element, texte, type) {
    element.textContent = texte;
    element.className = type ? "message " + type : "message";
}

function creerBouton(texte, classes) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = classes;
    bouton.textContent = texte;
    return bouton;
}

function creerCarte(prompt) {
    const carte = document.createElement("article");
    carte.className = "carte";

    const entete = document.createElement("div");
    entete.className = "carte-entete";

    const titre = document.createElement("h3");
    titre.textContent = prompt.titre;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = prompt.categorie;

    entete.append(titre, badge);

    const contenu = document.createElement("p");
    contenu.className = "prompt-contenu";
    contenu.textContent = prompt.contenu;

    const actions = document.createElement("div");
    actions.className = "carte-actions";

    const boutonCopier = creerBouton("Copier", "bouton bouton-discret");
    boutonCopier.addEventListener("click", () => copierPrompt(prompt.contenu, boutonCopier));

    const boutonLike = creerBouton("💙 " + prompt.likes, "bouton bouton-like");
    boutonLike.setAttribute("aria-label", "Aimer le prompt " + prompt.titre);
    boutonLike.addEventListener("click", () => aimerPrompt(prompt.id, boutonLike));

    actions.append(boutonCopier, boutonLike);
    carte.append(entete, contenu, actions);
    return carte;
}

function afficherPrompts(prompts) {
    grille.replaceChildren(...prompts.map(creerCarte));
}

// ---------- 6. Actions ----------
// Numéro de la dernière recherche : évite d'afficher une vieille réponse
// qui arriverait après une plus récente.
let numeroRequete = 0;

async function chargerPrompts() {
    numeroRequete += 1;
    const numero = numeroRequete;

    const parametres = new URLSearchParams();
    const recherche = champRecherche.value.trim();
    if (recherche) {
        parametres.set("q", recherche);
    }
    if (filtreCategorie.value) {
        parametres.set("categorie", filtreCategorie.value);
    }

    try {
        const prompts = await appelerApi(URL_PROMPTS + "?" + parametres.toString());
        if (numero !== numeroRequete) {
            return;
        }
        afficherPrompts(prompts);
        const mot = prompts.length > 1 ? "prompts trouvés" : "prompt trouvé";
        afficherMessage(messageListe, prompts.length + " " + mot, "");
    } catch (erreur) {
        if (numero !== numeroRequete) {
            return;
        }
        grille.replaceChildren();
        afficherMessage(messageListe, "Impossible de charger les prompts : " + erreur.message, "erreur");
    }
}

async function chargerStats() {
    try {
        const stats = await appelerApi(URL_STATS);
        statTotal.textContent = stats.total_prompts;
        statLikes.textContent = stats.total_likes;

        if (stats.par_categorie.length > 0) {
            const premiere = stats.par_categorie[0];
            statTop.textContent = "Top : " + premiere.categorie + " (" + premiere.nombre + ")";
        } else {
            statTop.textContent = "Aucun prompt pour l'instant";
        }
    } catch (erreur) {
        statTop.textContent = "Statistiques indisponibles";
    }
}

async function aimerPrompt(id, bouton) {
    bouton.disabled = true;
    try {
        const resultat = await appelerApi(URL_PROMPTS + "/" + id + "/like", { method: "POST" });
        bouton.textContent = "💙 " + resultat.likes;
        chargerStats();
    } catch (erreur) {
        afficherMessage(messageListe, "Erreur : " + erreur.message, "erreur");
    } finally {
        bouton.disabled = false;
    }
}

async function copierPrompt(texte, bouton) {
    const ancienTexte = bouton.textContent;
    try {
        await navigator.clipboard.writeText(texte);
        bouton.textContent = "Copié \u2713";
    } catch (erreur) {
        bouton.textContent = "Échec";
    }
    setTimeout(() => {
        bouton.textContent = ancienTexte;
    }, 1500);
}

// Recherche : on attend 300 ms après la dernière touche avant d'interroger le serveur.
let minuteur = null;
champRecherche.addEventListener("input", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(chargerPrompts, 300);
});

filtreCategorie.addEventListener("change", chargerPrompts);

// Formulaire d'ajout
formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();

    const donnees = {
        titre: formulaire.elements["titre"].value.trim(),
        categorie: formulaire.elements["categorie"].value,
        contenu: formulaire.elements["contenu"].value.trim(),
    };

    afficherMessage(messageFormulaire, "Envoi en cours...", "");

    try {
        await appelerApi(URL_PROMPTS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(donnees),
        });
        formulaire.reset();
        afficherMessage(messageFormulaire, "Prompt ajouté !", "ok");
        await Promise.all([chargerPrompts(), chargerStats()]);
    } catch (erreur) {
        afficherMessage(messageFormulaire, erreur.message, "erreur");
    }
});

// Idée de prompt, fournie par le petit serveur Java (facultatif)
boutonIdee.addEventListener("click", async () => {
    boutonIdee.disabled = true;
    texteIdee.textContent = "Réflexion en cours...";
    try {
        const reponse = await fetch(URL_IDEE_JAVA);
        if (!reponse.ok) {
            throw new Error("Erreur " + reponse.status);
        }
        const donnees = await reponse.json();
        texteIdee.textContent = donnees.idee;
    } catch (erreur) {
        texteIdee.textContent = "Le serveur Java ne répond pas. Lance-le avec la commande du guide (c'est facultatif).";
    } finally {
        boutonIdee.disabled = false;
    }
});

// ---------- 7. Démarrage ----------
appliquerTheme(lireThemeSauvegarde() === "light" ? "light" : "dark");
chargerPrompts();
chargerStats();
