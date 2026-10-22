import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Random;

/**
 * PromptHub : mini serveur Java qui renvoie une idee de prompt au hasard.
 * 
 * Lancement (dans le dossier du projet) :
 *     java -Dfile.encoding=UTF-8 IdeeServeur.java
 * 
 * Test dans le navigateur : http://127.0.0.1:8081/api/idee
 */
public class IdeeServeur {

    private static final int PORT = 8081;
    private static final Random HASARD = new Random();

    private static final List<String> ACTIONS = List.of(
            "expliquer", "résumer", "présenter", "simplifier", "illustrer");

    private static final List<String> SUJETS = List.of(
            "les bases de Python",
            "la photosynthèse",
            "le fonctionnement d'Internet",
            "un budget d'étudiant",
            "la gestion du temps",
            "l'histoire du Bénin");

    private static final List<String> FORMATS = List.of(
            "sous forme de liste de 5 points",
            "sous forme de petit quiz",
            "en 3 étapes simples",
            "avec une analogie du quotidien",
            "sous forme de dialogue entre deux amis");

    public static void main(String[] args) {
        try {
            InetSocketAddress adresse = new InetSocketAddress(InetAddress.getLoopbackAddress(), PORT);
            HttpServer serveur = HttpServer.create(adresse, 0);
            serveur.createContext("/api/idee", IdeeServeur::repondre);
            serveur.start();
            System.out.println("Serveur Java pret : http://127.0.0.1:" + PORT + "/api/idee");
            System.out.println("Appuie sur Ctrl + C pour l'arreter.");
        } catch (IOException erreur) {
            System.out.println("Impossible de demarrer le serveur : " + erreur.getMessage());
        }
    }

    /** Traite une requete : renvoie {"idee": "..."} au format JSON. */
    private static void repondre(HttpExchange echange) throws IOException {
        // Autorise la page du site (port 5050) a appeler ce serveur (port 8081).
        echange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");

        if (!"GET".equals(echange.getRequestMethod())) {
            echange.sendResponseHeaders(405, -1);
            echange.close();
            return;
        }

        String json = "{\"idee\":\"" + echapper(genererIdee()) + "\"}";
        byte[] octets = json.getBytes(StandardCharsets.UTF_8);

        echange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        echange.sendResponseHeaders(200, octets.length);
        try (OutputStream sortie = echange.getResponseBody()) {
            sortie.write(octets);
        }
    }

    private static String genererIdee() {
        return "Demande à l'IA de " + choisir(ACTIONS) + " " + choisir(SUJETS) + " " + choisir(FORMATS) + ".";
    }

    private static String choisir(List<String> liste) {
        return liste.get(HASARD.nextInt(liste.size()));
    }

    /** Protege les guillemets et les antislashs pour que le JSON reste valide. */
    private static String echapper(String texte) {
        return texte.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
