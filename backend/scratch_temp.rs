use sysinfo::Components;

fn main() {
    let mut components = Components::new();
    components.refresh_list();
    println!("Found {} components", components.len());
    for component in components.list() {
        println!("{:?}: {:?}", component.label(), component.temperature());
    }
}
