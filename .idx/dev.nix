# To learn more about how to use Nix to configure your environment
# see: https://firebase.google.com/docs/studio/customize-workspace
{ pkgs, ... }: {
  # Which nixpkgs channel to use.
  channel = "stable-24.05"; # or "unstable"
  # Use https://search.nixos.org/packages to find packages
  packages = [
    pkgs.python3
    pkgs.python3Packages.pip
    pkgs.python3Packages.flask
    pkgs.python3Packages.werkzeug
    pkgs.ffmpeg
  ]; # Ensure list is closed
  idx = {
    # Search for the extensions you want on https://open-vsx.org/ and use "publisher.id"
    extensions = [ "ms-python.python" ];
    workspace = {
      # Runs when a workspace is first created with this `dev.nix` file
      onCreate = {
        # install = "..." # Example comment
        # Open editors for the following files by default, if they exist:
        default.openFiles = [ "README.md" "index.html" "main.py" ]; # Updated to index.html in root
      }; # To run something each time the workspace is (re)started, use the `onStart` hook
    };
    # Enable previews and customize configuration
    previews = {
      enable = true;
      previews = {
        web = {
          # Use the Python from the virtual environment
          command = [ "./.venv/bin/python" "-m" "flask" "--app" "main" "run" "--host" "0.0.0.0" "--port" "$PORT" "--debug" ];
          env = { PORT = "$PORT"; };
          manager = "web";
        };
      };
    };
  };
}
