#!/bin/bash

# ANSI color codes
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

install_deps_routine() {
	echo -e "${CYAN}=================================================${NC}"
	echo -e "${CYAN}       VERIFYING & INSTALLING DEPENDENCIES       ${NC}"
	echo -e "${CYAN}=================================================${NC}"

	echo -e "${GREEN}[1/5] Checking for Rust/Cargo...${NC}"
	if ! command -v cargo &>/dev/null; then
		echo -e "${RED}[!] Rust not found. Installing via rustup...${NC}"
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
		echo -e "${GREEN}Rust installed! Please restart the terminal and run this script again.${NC}"
		exit 1
	else
		echo "[OK] Rust is installed."
	fi

	echo -e "${GREEN}[2/5] Checking for Node.js/npm...${NC}"
	if ! command -v npm &>/dev/null; then
		echo -e "${RED}[!] Node.js not found. Attempting to install...${NC}"
		if command -v brew &>/dev/null; then
			brew install node
		elif command -v apt-get &>/dev/null; then
			sudo apt-get update && sudo apt-get install -y nodejs npm
		elif command -v dnf &>/dev/null; then
			sudo dnf install -y nodejs npm
		elif command -v pacman &>/dev/null; then
			sudo pacman -S --noconfirm nodejs npm
		else
			echo -e "${RED}Could not detect package manager. Please install Node.js manually.${NC}"
			exit 1
		fi
	else
		echo "[OK] Node.js is installed."
	fi

	echo -e "${GREEN}[3/5] Checking for CMake...${NC}"
	if ! command -v cmake &>/dev/null; then
		echo -e "${RED}[!] CMake not found. Attempting to install...${NC}"
		if command -v brew &>/dev/null; then
			brew install cmake
		elif command -v apt-get &>/dev/null; then
			sudo apt-get update && sudo apt-get install -y cmake
		elif command -v dnf &>/dev/null; then
			sudo dnf install -y cmake
		elif command -v pacman &>/dev/null; then
			sudo pacman -S --noconfirm cmake
		else
			echo -e "${RED}Could not detect package manager. Please install CMake manually.${NC}"
			exit 1
		fi
	else
		echo "[OK] CMake is installed."
	fi

	echo -e "${GREEN}[4/5] Skipping Engine Setup (Handled in UI)...${NC}"

	echo -e "${GREEN}[5/5] Compiling and Baking application...${NC}"
	echo "Installing Frontend Dependencies..."
	cd frontend || exit
	npm install
	echo "Building Frontend Static Files..."
	npm run build
	cd ..

	echo "Building Backend Server (This may take a while)..."
	cd backend || exit
	if ! cargo build --release; then
		echo -e "${RED}[!] Failed to compile Backend Server.${NC}"
		exit 1
	fi
	cd ..

	echo "Building RPC Agent..."
	cd rpc_agent || exit
	if ! cargo build --release; then
		echo -e "${RED}[!] Failed to compile RPC Agent.${NC}"
		exit 1
	fi
	cd ..
}

while true; do
	clear
	echo -e "${CYAN}=================================================${NC}"
	echo -e "${CYAN}                 ONYX TERMINAL                   ${NC}"
	echo -e "${CYAN}=================================================${NC}"
	echo " [1] Start Primary Node (Dashboard & API Server)"
	echo " [2] Start RPC Worker Node (Compute Only)"
	echo " [3] Start Development Environment (Hot-Reloading)"
	echo " [4] Verify & Install System Dependencies"
	echo " [5] Package Release"
	echo " [0] Exit"
	echo -e "${CYAN}=================================================${NC}"
	read -p "Select an option (0-5): " choice

	case $choice in
	1)
		echo -e "${GREEN}Starting Primary Node...${NC}"
		if [ ! -f "backend/target/release/onyx" ]; then
			echo -e "${CYAN}[INFO] First time setup detected. Automatically installing dependencies and compiling...${NC}"
			install_deps_routine
		fi
		cd backend || exit
		cargo run --release
		cd ..
		read -p "Press Enter to return to menu..."
		;;
	2)
		echo -e "${GREEN}Starting RPC Worker Node...${NC}"
		if [ ! -f "rpc_agent/target/release/rpc_agent" ]; then
			echo -e "${CYAN}[INFO] First time setup detected. Automatically installing dependencies and compiling...${NC}"
			install_deps_routine
		fi
		cd rpc_agent || exit
		cargo run --release
		cd ..
		read -p "Press Enter to return to menu..."
		;;
	3)
		echo -e "${GREEN}Starting Development Environment...${NC}"
		# Check if any engines are installed in engines/
		if [ ! -d "engines" ] || [ -z "$(ls engines/*/llama-server* 2>/dev/null)" ]; then
			echo -e "${CYAN}[INFO] No engines installed. Running first-time setup...${NC}"
			install_deps_routine
		fi
		cd frontend || exit
		npm run dev &
		FRONTEND_PID=$!
		cd ../backend || exit
		cargo run &
		BACKEND_PID=$!
		cd ..
		echo "Development servers are running. Press Ctrl+C to stop."
		trap "kill $FRONTEND_PID $BACKEND_PID; exit" INT
		wait
		;;
	4)
		install_deps_routine
		echo -e "${CYAN}=================================================${NC}"
		echo -e "${GREEN}All dependencies installed and compiled successfully!${NC}"
		echo -e "${GREEN}You can now use option [1] or [2] to start Onyx.${NC}"
		echo -e "${CYAN}=================================================${NC}"
		read -p "Press Enter to return to menu..."
		;;
	0)
		echo "Exiting..."
		exit 0
		;;
	*)
		echo -e "${RED}Invalid option. Please try again.${NC}"
		read -p "Press Enter to return to menu..."
		;;
	esac
done
